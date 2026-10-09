import { useEffect, useRef, useState } from "react";
import {
  Activity,
  BarChart3,
  Bot,
  Boxes,
  CalendarDays,
  MessageCircle,
  RefreshCw,
  Send,
  ShoppingCart,
  Store,
  TrendingUp,
  X,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import "./App.css";

const API = "http://localhost:8000";
const CHART_COLORS = ["#4776e6", "#16a878", "#e9a23b", "#d46b62", "#4c9a9a", "#8266b0", "#73808f"];
const ASSISTANT_GREETING = "Hi, I can help explain the available retail data. I use the selected store/product and historical aggregates shown in this dashboard; forecasts are 7-day moving-average estimates, not XGBoost predictions.";

function buildManagerReply(question, context) {
  const query = question.toLowerCase();
  const { storeId, productId, productCatalog, history, forecast, historyThrough, forecastMethod, analyticsOverview, storeAnalytics, summary } = context;
  const product = productCatalog.find((item) => item.product_id === productId);
  const recentAverage = history.length
    ? history.reduce((total, item) => total + Number(item.demand), 0) / history.length
    : null;
  const requestedProductId = query.match(/\bP\d{4,}\b/i)?.[0]?.toUpperCase();

  if (requestedProductId && requestedProductId !== productId) {
    return `You asked about ${requestedProductId}, but the loaded product context is ${productId || "none"}. Change the Product selector to ${requestedProductId} before asking for its metrics; I will not substitute data from another product.`;
  }

  if (/help|what can|capabilit|ask/.test(query)) {
    return "Ask about the selected product’s recent demand, forecast, recorded inventory, category averages, promotion or seasonality comparisons, demand distribution, or store performance. I only summarize values returned by this project’s API.";
  }

  if (/forecast|predict|outlook|future|tomorrow|next\s+(\d+\s+)?days?/.test(query)) {
    if (!forecast.length) return "No forecast is loaded for the current selection yet. Choose a store and product on Demand Forecast, then try again.";
    const values = forecast.map((item) => Number(item.predicted_demand));
    const total = values.reduce((sum, value) => sum + value, 0);
    return `${forecastMethod} for ${productId} at ${storeId}: ${forecast.length} days from ${forecast[0].date} to ${forecast[forecast.length - 1].date}. Estimated total: ${total.toFixed(1)} units; first day: ${values[0].toFixed(1)}, last day: ${values[values.length - 1].toFixed(1)}. Historical input ends ${historyThrough}. Recursive averaging makes later estimates converge; this is not the trained XGBoost model.`;
  }

  if (/inventor|stock|reorder|safety stock|coverage/.test(query)) {
    if (!history.length) return "No product history is loaded. Select a store and product first.";
    const latest = history[history.length - 1];
    return `The latest recorded inventory for ${productId} at ${storeId} is ${Number(latest.inventory_level).toLocaleString()} units on ${latest.date}. This is a historical observation, not live stock. Reorder point, lead time, and safety stock cannot be calculated from the current project because those policies are not defined.`;
  }

  if (/promotion|promo|discount/.test(query)) {
    const rows = analyticsOverview?.promotion_comparison || [];
    if (!rows.length) return "Promotion aggregates are not loaded. Check the dashboard data connection and try again.";
    const noPromo = rows.find((row) => row.promotion === "No promotion");
    const promo = rows.find((row) => row.promotion === "Promotion");
    if (!noPromo || !promo) return "The current filtered data does not contain both promotion groups.";
    return `In the current ${analyticsOverview.store_id || "all-store"} historical slice, average demand was ${promo.average_demand.toFixed(1)} units across ${promo.record_count.toLocaleString()} promotion records and ${noPromo.average_demand.toFixed(1)} units across ${noPromo.record_count.toLocaleString()} records without promotion. This is an observed association, not evidence that promotion caused the difference.`;
  }

  if (/season|summer|winter|spring|autumn/.test(query)) {
    const rows = analyticsOverview?.seasonality_demand || [];
    if (!rows.length) return "Seasonality aggregates are not loaded. Check the dashboard data connection and try again.";
    const ranked = [...rows].sort((left, right) => right.average_demand - left.average_demand);
    return `Observed average demand by season in the ${analyticsOverview.store_id || "all-store"} slice: ${ranked.map((row) => `${row.seasonality} ${row.average_demand.toFixed(1)} units (${row.record_count.toLocaleString()} records)`).join("; ")}. These are historical comparisons, not a causal effect.`;
  }

  if (/categor|product mix|top product/.test(query)) {
    const rows = analyticsOverview?.category_demand || [];
    if (!rows.length) return "Category aggregates are not loaded. Check the dashboard data connection and try again.";
    const ranked = [...rows].sort((left, right) => right.average_demand - left.average_demand);
    return `Categories ranked by observed average demand in the ${analyticsOverview.store_id || "all-store"} slice: ${ranked.map((row) => `${row.category} ${row.average_demand.toFixed(1)} units per record`).join("; ")}. These are category totals/averages, not named individual products.`;
  }

  if (/distribution|demand range|how many.*(units|demand)|high demand|low demand/.test(query)) {
    const rows = analyticsOverview?.demand_distribution || [];
    if (!rows.length) return "Demand distribution data is not loaded. Check the dashboard data connection and try again.";
    const largest = [...rows].sort((left, right) => right.record_count - left.record_count)[0];
    return `The largest demand band in the ${analyticsOverview.store_id || "all-store"} slice is ${largest.band} units, containing ${largest.record_count.toLocaleString()} of ${analyticsOverview.record_count.toLocaleString()} records. The chart on Dashboard shows counts for all available bands.`;
  }

  if (/store|branch|location|region/.test(query)) {
    if (!storeAnalytics.length) return "Store comparison data is not loaded yet.";
    const top = [...storeAnalytics].sort((left, right) => right.total_demand - left.total_demand)[0];
    const selected = storeAnalytics.find((item) => item.store_id === storeId);
    if (selected && new RegExp(`\\b${storeId.toLowerCase()}\\b`).test(query)) {
      return `${storeId} has ${selected.total_demand.toLocaleString()} units of historical demand across ${selected.total_records.toLocaleString()} records, averaging ${selected.average_demand.toFixed(2)} units per record. The Store Analytics view compares it with the other stores.`;
    }
    return `Among ${storeAnalytics.length} stores, ${top.store_id} has the highest historical demand total at ${top.total_demand.toLocaleString()} units and an average of ${top.average_demand.toFixed(2)} units per record. This is aggregate historical demand, not a forecast.`;
  }

  if (/summary|overview|overall|dataset|data/.test(query)) {
    if (!summary) return "The dashboard summary has not loaded yet.";
    return `The historical dataset contains ${summary.total_records.toLocaleString()} records, ${summary.total_stores} stores, and ${summary.total_products} product IDs from ${summary.date_start} through ${summary.date_end}. Average demand is ${Number(summary.average_demand).toFixed(1)} units per record. The active forecast is a separate moving-average estimate.`;
  }

  if (/product|demand|sales|trend|selected/.test(query)) {
    if (!history.length) return "No product history is loaded. Select a store and product on Demand Forecast first.";
    const latest = history[history.length - 1];
    const itemLabel = product?.label || productId;
    const difference = Number(latest.demand) - recentAverage;
    const comparison = difference > 0 ? "above" : difference < 0 ? "below" : "at";
    return `${itemLabel} at ${storeId}: the latest observed demand was ${Number(latest.demand).toFixed(1)} units on ${latest.date}. Its average across the ${history.length} recent observations returned by the API was ${recentAverage.toFixed(1)} units; the latest value is ${Math.abs(difference).toFixed(1)} ${comparison} that average. Data ends ${historyThrough}.`;
  }

  return "I can answer from the loaded project data about the selected product, baseline forecast, historical inventory, categories, promotions, seasonality, demand bands, and store totals. Try asking one of those directly.";
}

function MetricCard({ title, value, subtitle, icon: Icon }) {
  return (
    <div className="metric-card">
      <div className="metric-top">
        <span>{title}</span>
        <div className="metric-icon">
          <Icon size={19} />
        </div>
      </div>
      <div className="metric-value">{value}</div>
      <div className="metric-subtitle">{subtitle}</div>
    </div>
  );
}

export default function App() {
  const [summary, setSummary] = useState(null);
  const [activeView, setActiveView] = useState("dashboard");
  const [stores, setStores] = useState([]);
  const [storeId, setStoreId] = useState("");
  const [productId, setProductId] = useState("");
  const [horizon, setHorizon] = useState("7");
  const [refreshKey, setRefreshKey] = useState(0);
  const [history, setHistory] = useState([]);
  const [forecast, setForecast] = useState([]);
  const [forecastMethod, setForecastMethod] = useState("7-day moving-average baseline");
  const [historyThrough, setHistoryThrough] = useState("");
  const [model, setModel] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [productCatalog, setProductCatalog] = useState([]);
  const [storeAnalytics, setStoreAnalytics] = useState([]);
  const [analyticsOverview, setAnalyticsOverview] = useState(null);
  const [analyticsStoreId, setAnalyticsStoreId] = useState("");
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [overviewError, setOverviewError] = useState("");
  const [dashboardLoading, setDashboardLoading] = useState(true);
  const [analyticsLoading, setAnalyticsLoading] = useState(true);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [methodology, setMethodology] = useState(null);
  const [methodologyLoading, setMethodologyLoading] = useState(true);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [assistantInput, setAssistantInput] = useState("");
  const [assistantMessages, setAssistantMessages] = useState([
    { role: "assistant", content: ASSISTANT_GREETING },
  ]);
  const assistantLogRef = useRef(null);
  useEffect(() => {
    let cancelled = false;

    async function loadDashboard() {
      try {
        const [summaryRes, storesRes, modelRes] = await Promise.all([
          fetch(`${API}/api/dashboard/summary`),
          fetch(`${API}/api/stores`),
          fetch(`${API}/api/model/status`),
        ]);

        if (!summaryRes.ok || !storesRes.ok) {
          throw new Error("Could not load dashboard data. Check the backend API.");
        }

        const summaryData = await summaryRes.json();
        const storesData = await storesRes.json();
        const modelData = modelRes.ok ? await modelRes.json() : null;

        const storeList = Array.isArray(storesData)
          ? storesData
          : Array.isArray(storesData.stores)
            ? storesData.stores
            : [];

          if (cancelled) return;

        setSummary(summaryData);
        setStores(storeList);
        setModel(modelData);

        if (storeList.length > 0) {
          setStoreId((current) =>
            storeList.includes(current) ? current : storeList[0],
          );
        } else {
          setError("No stores were returned by the backend.");
        }
      } catch (err) {
        if (cancelled) return;
        setError(
          err.message || "Could not connect to the backend at localhost:8000.",
        );
      } finally {
        if (!cancelled) setDashboardLoading(false);
      }
    }

    async function loadStoreAnalytics() {
      try {
        const response = await fetch(`${API}/api/analytics/stores`);
        if (!response.ok) throw new Error("Could not load store analytics.");
        const data = await response.json();
        if (!cancelled) setStoreAnalytics(data.stores || []);
      } catch (err) {
        if (!cancelled) setError(err.message || "Could not load store analytics.");
      } finally {
        if (!cancelled) setAnalyticsLoading(false);
      }
    }

    loadDashboard();
    loadStoreAnalytics();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadAnalyticsOverview() {
      try {
        const query = analyticsStoreId
          ? `?store_id=${encodeURIComponent(analyticsStoreId)}`
          : "";
        const response = await fetch(`${API}/api/analytics/overview${query}`);
        if (!response.ok) throw new Error("Could not load historical analytics.");
        const data = await response.json();
        if (cancelled) return;
        setAnalyticsOverview(data);
        setOverviewError("");
      } catch (err) {
        if (!cancelled) {
          setAnalyticsOverview(null);
          setOverviewError(err.message || "Could not load historical analytics.");
        }
      } finally {
        if (!cancelled) setOverviewLoading(false);
      }
    }

    loadAnalyticsOverview();
    return () => {
      cancelled = true;
    };
  }, [analyticsStoreId]);

  useEffect(() => {
    if (!storeId) return;

    let cancelled = false;

    async function loadProducts() {
      try {
        const encodedStore = encodeURIComponent(storeId);
        const catalogResponse = await fetch(
          `${API}/api/product-catalog?store_id=${encodedStore}`,
        );

        if (!catalogResponse.ok) {
          throw new Error("Could not load product categories.");
        }

        const catalogResult = await catalogResponse.json();
        const catalogList = Array.isArray(catalogResult.products)
          ? catalogResult.products
          : [];

        if (cancelled) return;

        setCatalogLoading(false);
        setProductCatalog(catalogList);

        setProductId((current) =>
          catalogList.some((item) => item.product_id === current)
            ? current
            : catalogList[0]?.product_id || ""
        );

        if (catalogList.length === 0) {
          setError(`No products found for store ${storeId}.`);
          setLoading(false);
        } else {
          setLoading(true);
          setError("");
        }
      } catch (err) {
        if (cancelled) return;

        setCatalogLoading(false);
        setLoading(false);
        setProductCatalog([]);
        setProductId("");
        setError(
          err.message || "Could not load products for the selected store."
        );
      }
    }

    loadProducts();

    return () => {
      cancelled = true;
    };
  }, [storeId]);

  useEffect(() => {
    if (!storeId || !productId) return;

    let cancelled = false;

    async function loadForecast() {
      try {
        const query = `store_id=${encodeURIComponent(storeId)}&product_id=${encodeURIComponent(productId)}`;
        const [historyRes, forecastRes] = await Promise.all([
          fetch(`${API}/api/forecast/history?${query}`),
          fetch(`${API}/api/forecast?${query}&horizon=${horizon}`),
        ]);

        if (!historyRes.ok || !forecastRes.ok) {
          const failed = !historyRes.ok ? historyRes : forecastRes;
          let message = "Unable to generate the forecast.";
          try {
            const details = await failed.json();
            message = details.detail || message;
          } catch {
            // Keep the fallback message.
          }
          throw new Error(message);
        }

        const historyData = await historyRes.json();
        const forecastData = await forecastRes.json();
        if (cancelled) return;

        setHistory(historyData.observations || []);
        setForecast(forecastData.forecast || []);
        setForecastMethod(
          forecastData.forecast_method || "7-day moving-average baseline",
        );
        setHistoryThrough(
          historyData.latest_date || forecastData.history_through || "",
        );
        setError("");
      } catch (err) {
        if (cancelled) return;
        setError(err.message || "Unable to load forecast data.");
        setHistory([]);
        setForecast([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadForecast();

    return () => {
      cancelled = true;
    };
  }, [storeId, productId, horizon, refreshKey]);

  useEffect(() => {
    let cancelled = false;

    async function loadMethodology() {
      try {
        const response = await fetch(`${API}/api/model/methodology`);
        if (!response.ok) throw new Error("Could not load model methodology data.");
        const data = await response.json();
        if (!cancelled) setMethodology(data);
      } catch {
        if (!cancelled) setMethodology(null);
      } finally {
        if (!cancelled) setMethodologyLoading(false);
      }
    }

    loadMethodology();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!assistantOpen || !assistantLogRef.current) return;
    assistantLogRef.current.scrollTop = assistantLogRef.current.scrollHeight;
  }, [assistantMessages, assistantOpen]);

  function requestForecast() {
    setLoading(true);
    setError("");
    setRefreshKey((current) => current + 1);
  }

  const lastHistoricalDemand = history.length
    ? Number(history[history.length - 1].demand)
    : null;

  const chartData = [
    ...history.map((item, index) => ({
      date: item.date,
      actualDemand: Number(item.demand),
      forecastDemand:
        index === history.length - 1 ? lastHistoricalDemand : null,
    })),
    ...forecast.map((item) => ({
      date: item.date,
      actualDemand: null,
      forecastDemand: Number(item.predicted_demand),
    })),
  ];

  const latestObservation = history[history.length - 1];
  const pageTitles = {
    dashboard: "Dashboard Overview",
    forecast: "Demand Forecast",
    inventory: "Inventory Insights",
    stores: "Store Analytics",
    methodology: "How We Trained Our Model",
  };
  const pageDescriptions = {
    dashboard: "Historical retail activity and the selected product trend.",
    forecast: "Product-level projections from the seven-day moving-average baseline.",
    inventory: "Recorded stock and demand observations for the selected product.",
    stores: "Compare historical demand totals and averages across stores.",
    methodology: "Evidence-based overview of the dataset, temporal split, model training, and evaluation used for the project.",
  };

  function changeStore(value) {
    setStoreId(value);
    setProductId("");
    setProductCatalog([]);
    setHistory([]);
    setForecast([]);
    setCatalogLoading(true);
    setLoading(true);
    setError("");
  }

  function changeProduct(value) {
    setProductId(value);
    setHistory([]);
    setForecast([]);
    setLoading(true);
    setError("");
  }

  function changeHorizon(value) {
    setHorizon(value);
    setForecast([]);
    setLoading(true);
    setError("");
  }

  function changeAnalyticsStore(value) {
    setAnalyticsStoreId(value);
    setAnalyticsOverview(null);
    setOverviewLoading(true);
    setOverviewError("");
  }

  function sendAssistantMessage(event, suggestedQuestion) {
    event?.preventDefault();
    const question = (suggestedQuestion || assistantInput).trim();
    if (!question) return;

    const reply = buildManagerReply(question, {
      storeId,
      productId,
      productCatalog,
      history,
      forecast,
      historyThrough,
      forecastMethod,
      analyticsOverview,
      storeAnalytics,
      summary,
    });
    setAssistantMessages((messages) => [
      ...messages,
      { role: "user", content: question },
      { role: "assistant", content: reply },
    ]);
    setAssistantInput("");
  }

  function renderDemandChart() {
    if (loading) {
      return <div className="empty-chart">Loading selected-product history and forecast...</div>;
    }
    if (!chartData.length) {
      return <div className="empty-chart">Select a store and product to view demand.</div>;
    }

    return (
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData} margin={{ top: 12, right: 12, left: 0, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e9edf3" />
          <XAxis dataKey="date" tick={{ fill: "#778196", fontSize: 11 }} tickLine={false} axisLine={false} minTickGap={28} />
          <YAxis tick={{ fill: "#778196", fontSize: 11 }} tickLine={false} axisLine={false} width={45} />
          <Tooltip />
          <Legend />
          <Line type="monotone" dataKey="actualDemand" name="Historical demand" stroke="#4776e6" strokeWidth={2.5} dot={false} connectNulls={false} />
          <Line type="monotone" dataKey="forecastDemand" name="Forecast estimate" stroke="#16a878" strokeWidth={2.5} strokeDasharray="5 4" dot={{ r: 3 }} connectNulls={false} />
        </LineChart>
      </ResponsiveContainer>
    );
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark"><Boxes size={23} /></div>
          <div>
            <div className="brand-name">RetailSense</div>
            <div className="brand-caption">INTELLIGENCE PLATFORM</div>
          </div>
        </div>
        <div className="nav-label">WORKSPACE</div>
        <nav className="workspace-nav" aria-label="Workspace">
          <button className={`nav-item ${activeView === "dashboard" ? "active" : ""}`} aria-current={activeView === "dashboard" ? "page" : undefined} onClick={() => setActiveView("dashboard")}>
            <BarChart3 size={18} /> Dashboard
          </button>
          <button className={`nav-item ${activeView === "forecast" ? "active" : ""}`} aria-current={activeView === "forecast" ? "page" : undefined} onClick={() => setActiveView("forecast")}>
            <TrendingUp size={18} /> Demand Forecast
          </button>
          <button className={`nav-item ${activeView === "inventory" ? "active" : ""}`} aria-current={activeView === "inventory" ? "page" : undefined} onClick={() => setActiveView("inventory")}>
            <Boxes size={18} /> Inventory Insights
          </button>
          <button className={`nav-item ${activeView === "stores" ? "active" : ""}`} aria-current={activeView === "stores" ? "page" : undefined} onClick={() => setActiveView("stores")}>
            <Store size={18} /> Store Analytics
          </button>
          <button className={`nav-item ${activeView === "methodology" ? "active" : ""}`} aria-current={activeView === "methodology" ? "page" : undefined} onClick={() => setActiveView("methodology")}>
            <Activity size={18} /> How We Trained Our Model
          </button>
        </nav>
        <div className="sidebar-bottom">
          <div className={`status-dot ${summary ? "connected" : "disconnected"}`} />
          <div>
            <div className="status-title">API connection</div>
            <div className="status-caption">
              {summary ? "Connected to backend" : dashboardLoading ? "Connecting..." : "Backend unavailable"}
            </div>
          </div>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div>
            <div className="breadcrumb">Workspace / {pageTitles[activeView]}</div>
            <h1>{pageTitles[activeView]}</h1>
            <p className="page-subtitle">{pageDescriptions[activeView]}</p>
          </div>
        </header>

        {error && <div className="error-banner" role="alert">{error}</div>}

        {activeView === "dashboard" && (
          <>
            <section className="analytics-toolbar" aria-label="Dashboard filters">
              <div className="filter-context">
                <span className="filter-kicker">HISTORICAL DATA</span>
                <strong>{summary ? `${summary.date_start} to ${summary.date_end}` : "Loading date range..."}</strong>
              </div>
              <label className="dashboard-filter" htmlFor="analytics-store-select">
                <span>Store filter</span>
                <select id="analytics-store-select" value={analyticsStoreId} onChange={(event) => changeAnalyticsStore(event.target.value)}>
                  <option value="">All stores</option>
                  {stores.map((store) => <option key={store} value={store}>{store}</option>)}
                </select>
              </label>
            </section>
            <section className="metric-grid" aria-label="Historical dataset summary">
              <MetricCard title="Historical Records" value={analyticsOverview ? Number(analyticsOverview.record_count).toLocaleString() : overviewLoading ? "Loading..." : "—"} subtitle={analyticsStoreId ? `Observations for ${analyticsStoreId}` : "Observations across all stores"} icon={Activity} />
              <MetricCard title="Stores" value={analyticsStoreId ? "1" : summary ? Number(summary.total_stores).toLocaleString() : dashboardLoading ? "Loading..." : "—"} subtitle="Stores represented in this view" icon={Store} />
              <MetricCard title="Products" value={summary ? Number(summary.total_products).toLocaleString() : dashboardLoading ? "Loading..." : "—"} subtitle="Unique product IDs tracked" icon={ShoppingCart} />
              <MetricCard title="Average Historical Demand" value={analyticsOverview?.category_demand?.length ? (analyticsOverview.category_demand.reduce((total, item) => total + item.average_demand * item.record_count, 0) / analyticsOverview.record_count).toFixed(1) : overviewLoading ? "Loading..." : "—"} subtitle="Units per historical record" icon={TrendingUp} />
            </section>
            <section className="panel chart-panel">
              <div className="panel-heading">
                <div><h2>Monthly Demand Trend</h2><p>{analyticsStoreId || "All stores"} · observed monthly demand</p></div>
                <span className="historical-tag"><span /> HISTORICAL</span>
              </div>
              <div className="chart-wrap wide-chart">
                {overviewLoading ? <div className="empty-chart">Loading monthly demand...</div> : analyticsOverview?.monthly_demand?.length ? (
                  <ResponsiveContainer width="100%" height="100%"><AreaChart data={analyticsOverview.monthly_demand} margin={{ top: 14, right: 16, left: 0, bottom: 0 }}>
                    <defs><linearGradient id="demandFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#4776e6" stopOpacity={0.24} /><stop offset="95%" stopColor="#4776e6" stopOpacity={0.02} /></linearGradient></defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e9edf3" />
                    <XAxis dataKey="month" tick={{ fill: "#778196", fontSize: 10 }} tickLine={false} axisLine={false} minTickGap={24} />
                    <YAxis tick={{ fill: "#778196", fontSize: 10 }} tickLine={false} axisLine={false} width={52} />
                    <Tooltip formatter={(value, name) => [Number(value).toLocaleString(), name === "total_demand" ? "Observed demand" : "Average demand"]} />
                    <Area type="monotone" dataKey="total_demand" name="Observed demand" stroke="#4776e6" strokeWidth={2.5} fill="url(#demandFill)" />
                  </AreaChart></ResponsiveContainer>
                ) : <div className="empty-chart">{overviewError || "No monthly demand is available for this filter."}</div>}
              </div>
              <div className="chart-footnote"><CalendarDays size={15} />Observed demand grouped by calendar month. A partial month may have fewer records.</div>
            </section>
            {overviewError && <div className="error-banner" role="alert">{overviewError}</div>}
            <section className="visual-grid">
              <div className="panel visual-panel">
                <div className="panel-heading"><div><h2>Demand by Category</h2><p>Average daily units and total volume</p></div></div>
                <div className="chart-wrap compact-chart">{overviewLoading ? <div className="empty-chart">Loading category data...</div> : analyticsOverview?.category_demand?.length ? (
                  <ResponsiveContainer width="100%" height="100%"><BarChart data={analyticsOverview.category_demand} layout="vertical" margin={{ top: 4, right: 18, left: 6, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e9edf3" /><XAxis type="number" tick={{ fill: "#778196", fontSize: 10 }} tickLine={false} axisLine={false} /><YAxis type="category" dataKey="category" width={85} tick={{ fill: "#536074", fontSize: 10 }} tickLine={false} axisLine={false} /><Tooltip formatter={(value, name) => [Number(value).toLocaleString(), name === "average_demand" ? "Average units / record" : "Total units"]} /><Bar dataKey="average_demand" name="Average demand" radius={[0, 4, 4, 0]}>{analyticsOverview.category_demand.map((item, index) => <Cell key={item.category} fill={CHART_COLORS[index % CHART_COLORS.length]} />)}</Bar>
                  </BarChart></ResponsiveContainer>
                ) : <div className="empty-chart">No category data available.</div>}</div>
              </div>
              <div className="panel visual-panel">
                <div className="panel-heading"><div><h2>Promotion Comparison</h2><p>Observed average demand by promotion flag</p></div></div>
                <div className="chart-wrap compact-chart">{overviewLoading ? <div className="empty-chart">Loading promotion data...</div> : analyticsOverview?.promotion_comparison?.length ? (
                  <ResponsiveContainer width="100%" height="100%"><BarChart data={analyticsOverview.promotion_comparison} margin={{ top: 12, right: 12, left: -10, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e9edf3" /><XAxis dataKey="promotion" tick={{ fill: "#778196", fontSize: 10 }} tickLine={false} axisLine={false} /><YAxis tick={{ fill: "#778196", fontSize: 10 }} tickLine={false} axisLine={false} /><Tooltip formatter={(value) => [`${Number(value).toFixed(1)} units`, "Average demand"]} /><Bar dataKey="average_demand" name="Average demand" radius={[4, 4, 0, 0]}>{analyticsOverview.promotion_comparison.map((item, index) => <Cell key={item.promotion} fill={index ? "#e9a23b" : "#4776e6"} />)}</Bar>
                  </BarChart></ResponsiveContainer>
                ) : <div className="empty-chart">No promotion comparison available.</div>}</div>
              </div>
              <div className="panel visual-panel">
                <div className="panel-heading"><div><h2>Demand by Seasonality</h2><p>Observed average units per record</p></div></div>
                <div className="chart-wrap compact-chart">{overviewLoading ? <div className="empty-chart">Loading seasonal data...</div> : analyticsOverview?.seasonality_demand?.length ? (
                  <ResponsiveContainer width="100%" height="100%"><BarChart data={analyticsOverview.seasonality_demand} margin={{ top: 12, right: 12, left: -10, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e9edf3" /><XAxis dataKey="seasonality" tick={{ fill: "#778196", fontSize: 10 }} tickLine={false} axisLine={false} /><YAxis tick={{ fill: "#778196", fontSize: 10 }} tickLine={false} axisLine={false} /><Tooltip formatter={(value) => [`${Number(value).toFixed(1)} units`, "Average demand"]} /><Bar dataKey="average_demand" name="Average demand" radius={[4, 4, 0, 0]}>{analyticsOverview.seasonality_demand.map((item, index) => <Cell key={item.seasonality} fill={CHART_COLORS[(index + 2) % CHART_COLORS.length]} />)}</Bar>
                  </BarChart></ResponsiveContainer>
                ) : <div className="empty-chart">No seasonal data available.</div>}</div>
              </div>
              <div className="panel visual-panel">
                <div className="panel-heading"><div><h2>Demand Distribution</h2><p>Record count by observed demand band</p></div></div>
                <div className="chart-wrap compact-chart">{overviewLoading ? <div className="empty-chart">Loading distribution...</div> : analyticsOverview?.demand_distribution?.length ? (
                  <ResponsiveContainer width="100%" height="100%"><BarChart data={analyticsOverview.demand_distribution} margin={{ top: 12, right: 12, left: -10, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e9edf3" /><XAxis dataKey="band" tick={{ fill: "#778196", fontSize: 10 }} tickLine={false} axisLine={false} /><YAxis tick={{ fill: "#778196", fontSize: 10 }} tickLine={false} axisLine={false} /><Tooltip formatter={(value) => [Number(value).toLocaleString(), "Records"]} /><Bar dataKey="record_count" name="Records" fill="#4c9a9a" radius={[4, 4, 0, 0]} />
                  </BarChart></ResponsiveContainer>
                ) : <div className="empty-chart">No demand distribution available.</div>}</div>
              </div>
            </section>
          </>
        )}

        {activeView === "forecast" && (
          <>
            <div className="method-note">
              <TrendingUp size={17} />
              <p><strong>Why the forecast flattens:</strong> the current 7-day moving-average baseline feeds each predicted value into the next step. That recursive averaging damps variation and converges toward a stable level. It is a baseline estimate, not the trained XGBoost model.</p>
            </div>
            <section className="content-grid forecast-layout">
              <div className="panel chart-panel">
                <div className="panel-heading">
                  <div><h2>Demand Projection</h2><p>Historical observations and future estimates</p></div>
                  <span className="live-tag"><span /> {forecastMethod.toUpperCase()}</span>
                </div>
                <div className="chart-wrap">{renderDemandChart()}</div>
                <div className="chart-footnote"><CalendarDays size={15} />
                  {historyThrough ? `Historical data through ${historyThrough}; forecast dates follow this cutoff.` : "Historical cutoff will appear when data loads."}
                </div>
              </div>
              <div className="panel forecast-panel">
                <div className="panel-heading"><div><h2>Forecast Controls</h2><p>Choose the series and prediction window</p></div></div>
                <label className="field-label" htmlFor="store-select">STORE</label>
                <select id="store-select" value={storeId} onChange={(event) => changeStore(event.target.value)} disabled={dashboardLoading || stores.length === 0}>
                  {stores.map((store) => <option key={store} value={store}>{store}</option>)}
                </select>
                <label className="field-label" htmlFor="product-select">PRODUCT ID AND CATEGORY</label>
                <select id="product-select" value={productId} onChange={(event) => changeProduct(event.target.value)} disabled={catalogLoading || productCatalog.length === 0}>
                  {productCatalog.map((item) => <option key={item.product_id} value={item.product_id}>{item.label}</option>)}
                </select>
                <label className="field-label" htmlFor="horizon-select">FORECAST HORIZON</label>
                <select id="horizon-select" value={horizon} onChange={(event) => changeHorizon(event.target.value)}>
                  <option value="7">Next 7 days</option><option value="14">Next 14 days</option><option value="30">Next 30 days</option>
                </select>
                <button className="primary-button" onClick={requestForecast} disabled={loading || !productId}>
                  <RefreshCw size={16} className={loading ? "spin" : ""} />{loading ? "Updating estimate..." : "Update forecast estimate"}
                </button>
                <div className="divider" />
                <div className="mini-stat"><span>Forecast method</span><strong className="method-value">{forecastMethod}</strong></div>
                <div className="mini-stat"><span>Historical data through</span><strong>{historyThrough || "—"}</strong></div>
                <div className="mini-stat"><span>Estimate points</span><strong>{loading ? "Loading..." : forecast.length}</strong></div>
              </div>
            </section>
            <section className="panel table-panel">
              <div className="panel-heading"><div><h2>Forecast Estimates</h2><p>Predicted demand by future date; these are estimates, not observed sales</p></div><span className="table-count">{forecast.length} records</span></div>
              <div className="table-scroll"><table>
                <thead><tr><th>Forecast Date</th><th>Horizon</th><th>Estimated Demand</th><th>Method</th></tr></thead>
                <tbody>{forecast.length ? forecast.map((item) => (
                  <tr key={item.date}><td>{item.date}</td><td>Day {item.forecast_horizon}</td><td className="demand-cell">{Number(item.predicted_demand).toFixed(2)} units</td><td><span className="forecast-badge">Baseline estimate</span></td></tr>
                )) : <tr><td colSpan="4" className="empty-table">{loading ? "Loading forecast estimates..." : "No forecast estimates available for this selection."}</td></tr>}</tbody>
              </table></div>
            </section>
          </>
        )}

        {activeView === "inventory" && (
          <>
            <section className="metric-grid metrics-three">
              <MetricCard title="Latest Recorded Inventory" value={latestObservation ? Number(latestObservation.inventory_level).toLocaleString() : loading ? "Loading..." : "—"} subtitle={historyThrough ? `Observed ${historyThrough} · ${storeId} · ${productId}` : "Historical stock observation, not live inventory"} icon={Boxes} />
              <MetricCard title="Average Historical Demand" value={history.length ? (history.reduce((sum, item) => sum + Number(item.demand), 0) / history.length).toFixed(1) : loading ? "Loading..." : "—"} subtitle={`Units per observation across ${history.length || "—"} recent records`} icon={TrendingUp} />
              <MetricCard title="Forecast Demand Estimate" value={forecast.length ? forecast.reduce((sum, item) => sum + Number(item.predicted_demand), 0).toFixed(1) : loading ? "Loading..." : "—"} subtitle={`Estimated total over the next ${horizon} days`} icon={ShoppingCart} />
            </section>
            <section className="panel table-panel">
              <div className="panel-heading"><div><h2>Recent Historical Inventory</h2><p>Recorded stock and demand observations, not a live inventory feed</p></div><span className="table-count">{history.length} observations</span></div>
              <div className="table-scroll"><table>
                <thead><tr><th>Date</th><th>Observed Demand</th><th>Recorded Inventory</th></tr></thead>
                <tbody>{history.length ? history.map((item) => (
                  <tr key={item.date}><td>{item.date}</td><td>{Number(item.demand).toLocaleString()} units</td><td>{Number(item.inventory_level).toLocaleString()} units</td></tr>
                )) : <tr><td colSpan="3" className="empty-table">{loading ? "Loading historical inventory..." : "No historical observations available."}</td></tr>}</tbody>
              </table></div>
              <p className="inventory-note">Reorder recommendations are not available: lead time, target service level, and safety-stock policy are not defined by the current API.</p>
            </section>
          </>
        )}

        {activeView === "stores" && (
          <>
            {!analyticsLoading && storeAnalytics.length > 0 && (
              <section className="metric-grid metrics-three">
                <MetricCard title="Stores Compared" value={storeAnalytics.length} subtitle="Stores with historical records" icon={Store} />
                <MetricCard title="Combined Historical Demand" value={storeAnalytics.reduce((sum, store) => sum + store.total_demand, 0).toLocaleString()} subtitle="Units across all store records" icon={Activity} />
                <MetricCard title="Highest Store Average" value={Math.max(...storeAnalytics.map((store) => store.average_demand)).toFixed(2)} subtitle="Units per historical record" icon={TrendingUp} />
              </section>
            )}
            <section className="panel chart-panel store-chart-panel">
              <div className="panel-heading"><div><h2>Average Demand by Store</h2><p>Historical units per record; bars use a common zero baseline</p></div><span className="historical-tag"><span /> HISTORICAL</span></div>
              <div className="chart-wrap compact-chart">{analyticsLoading ? <div className="empty-chart">Loading store comparison...</div> : storeAnalytics.length ? (
                <ResponsiveContainer width="100%" height="100%"><BarChart data={storeAnalytics} margin={{ top: 12, right: 14, left: 2, bottom: 2 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e9edf3" />
                  <XAxis dataKey="store_id" tick={{ fill: "#778196", fontSize: 10 }} tickLine={false} axisLine={false} />
                  <YAxis domain={[0, "auto"]} tick={{ fill: "#778196", fontSize: 10 }} tickLine={false} axisLine={false} />
                  <Tooltip formatter={(value) => [`${Number(value).toFixed(2)} units`, "Average demand"]} />
                  <Bar dataKey="average_demand" name="Average demand" fill="#4776e6" radius={[4, 4, 0, 0]} />
                </BarChart></ResponsiveContainer>
              ) : <div className="empty-chart">No store comparison is available.</div>}</div>
            </section>
            <section className="panel table-panel">
              <div className="panel-heading"><div><h2>Historical Store Comparison</h2><p>Aggregate demand from the cleaned historical dataset</p></div></div>
              <div className="table-scroll"><table>
                <thead><tr><th>Store ID</th><th>Total Historical Demand</th><th>Average Demand</th><th>Historical Records</th><th>Unique Products</th></tr></thead>
                <tbody>{storeAnalytics.length ? storeAnalytics.map((store) => (
                  <tr key={store.store_id}><td>{store.store_id}</td><td>{Number(store.total_demand).toLocaleString()}</td><td>{Number(store.average_demand).toFixed(2)}</td><td>{Number(store.total_records).toLocaleString()}</td><td>{store.total_products}</td></tr>
                )) : <tr><td colSpan="5" className="empty-table">{analyticsLoading ? "Loading store analytics..." : "No store analytics are available."}</td></tr>}</tbody>
              </table></div>
            </section>
          </>
        )}

        {activeView === "methodology" && (
          <>
            <section className="panel methodology-summary">
              <div className="methodology-header">
                <div>
                  <div className="methodology-eyebrow">PROJECT METHODOLOGY</div>
                  <h2>Modeling and evaluation summary</h2>
                </div>
                <span className="historical-tag"><span /> EVIDENCE-BASED</span>
              </div>
              <p>
                {methodologyLoading ? "Loading the project training summary..." : (
                  methodology ? `This project uses a temporal retail demand forecasting workflow built from ${methodology.dataset.rows?.toLocaleString()} cleaned observations across ${methodology.dataset.stores} stores and ${methodology.dataset.products} products.` : "The methodology dataset is not available."
                )}
              </p>
            </section>

            {methodology && (
              <>
                <section className="metric-grid methodology-grid" aria-label="Methodology summary metrics">
                  <MetricCard title="Dataset Rows" value={Number(methodology.dataset.rows || 0).toLocaleString()} subtitle="Cleaned observations" icon={Activity} />
                  <MetricCard title="Stores" value={Number(methodology.dataset.stores || 0).toLocaleString()} subtitle="Store IDs in the cleaned dataset" icon={Store} />
                  <MetricCard title="Products" value={Number(methodology.dataset.products || 0).toLocaleString()} subtitle="Distinct product IDs tracked" icon={ShoppingCart} />
                  <MetricCard title="Date Range" value={`${methodology.dataset.date_start || "—"} to ${methodology.dataset.date_end || "—"}`} subtitle="Full dataset period" icon={CalendarDays} />
                </section>

                <section className="methodology-layout">
                  <div className="panel">
                    <div className="panel-heading">
                      <div><h2>Section A: Dataset overview</h2><p>Actual project information</p></div>
                    </div>
                    <dl className="methodology-details">
                      <div><dt>Dataset name</dt><dd>{methodology.dataset.name || "Unknown"}</dd></div>
                      <div><dt>Source</dt><dd>{methodology.dataset.source || "Not recorded"}</dd></div>
                      <div><dt>Rows × columns</dt><dd>{Number(methodology.dataset.rows || 0).toLocaleString()} × {Number(methodology.dataset.columns || 0).toLocaleString()}</dd></div>
                      <div><dt>Store count</dt><dd>{Number(methodology.dataset.stores || 0).toLocaleString()}</dd></div>
                      <div><dt>Product count</dt><dd>{Number(methodology.dataset.products || 0).toLocaleString()}</dd></div>
                      <div><dt>Date range</dt><dd>{methodology.dataset.date_start || "—"} to {methodology.dataset.date_end || "—"}</dd></div>
                      <div><dt>Target variable</dt><dd>{methodology.dataset.target || "Demand"}</dd></div>
                      <div><dt>Forecast horizon</dt><dd>{methodology.dataset.forecast_horizon || methodology.evaluation_summary.forecast_horizon || 7} days</dd></div>
                      <div><dt>Missing values</dt><dd>{Number(methodology.dataset.missing_values || 0).toLocaleString()}</dd></div>
                      <div><dt>Duplicate rows</dt><dd>{Number(methodology.dataset.duplicate_rows || 0).toLocaleString()}</dd></div>
                    </dl>
                  </div>

                  <div className="panel">
                    <div className="panel-heading">
                      <div><h2>Section B: ML workflow</h2><p>Actual pipeline used by the project</p></div>
                    </div>
                    <div className="pipeline-flow">
                      {methodology.pipeline?.stages?.map((stage, index) => (
                        <div key={stage} className={`pipeline-step ${methodology.pipeline?.status?.[stage] === "Completed" ? "complete" : "planned"}`}>
                          <span>{index + 1}</span>
                          <strong>{stage}</strong>
                        </div>
                      ))}
                    </div>
                    <ul className="pipeline-list">
                      {Object.entries(methodology.pipeline?.status || {}).map(([stage, status]) => (
                        <li key={stage}><strong>{stage}:</strong> {status}</li>
                      ))}
                    </ul>
                  </div>
                </section>

                <section className="panel chart-panel methodology-chart-panel">
                  <div className="panel-heading"><div><h2>Section C: Notebook charts</h2><p>Charts generated from project artifacts or clearly marked as not yet generated</p></div></div>
                  <div className="visual-grid methodology-grid">
                    <div className="panel visual-panel">
                      <div className="panel-heading"><div><h2>Historical Demand Trend</h2><p>Monthly aggregated demand · historical</p></div></div>
                      <div className="chart-wrap compact-chart">
                        {methodology.chart_data?.monthly_demand?.length ? (
                          <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={methodology.chart_data.monthly_demand} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
                              <defs><linearGradient id="methodologyDemandFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#4776e6" stopOpacity={0.24} /><stop offset="100%" stopColor="#4776e6" stopOpacity={0.02} /></linearGradient></defs>
                              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e9edf3" />
                              <XAxis dataKey="month" tick={{ fill: "#778196", fontSize: 10 }} tickLine={false} axisLine={false} minTickGap={18} />
                              <YAxis tick={{ fill: "#778196", fontSize: 10 }} tickLine={false} axisLine={false} width={42} />
                              <Tooltip formatter={(value) => [Number(value).toLocaleString(), "Total demand"]} />
                              <Area type="monotone" dataKey="total_demand" name="Total demand" stroke="#4776e6" strokeWidth={2.5} fill="url(#methodologyDemandFill)" />
                            </AreaChart>
                          </ResponsiveContainer>
                        ) : <div className="empty-chart">Not yet generated.</div>}
                      </div>
                    </div>

                    <div className="panel visual-panel">
                      <div className="panel-heading"><div><h2>Actual vs Predicted Demand</h2><p>Test-period actuals versus model forecasts · test</p></div></div>
                      <div className="chart-wrap compact-chart">
                        {methodology.chart_data?.actual_vs_predicted?.length ? (
                          <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={methodology.chart_data.actual_vs_predicted.slice(0, 200)} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
                              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e9edf3" />
                              <XAxis dataKey="date" tick={{ fill: "#778196", fontSize: 10 }} tickLine={false} axisLine={false} minTickGap={18} />
                              <YAxis tick={{ fill: "#778196", fontSize: 10 }} tickLine={false} axisLine={false} width={42} />
                              <Tooltip formatter={(value, name) => [Number(value).toFixed(2), name === "actual" ? "Actual" : "Predicted"]} />
                              <Legend />
                              <Line type="monotone" dataKey="actual" name="Actual" stroke="#4776e6" strokeWidth={2} dot={false} />
                              <Line type="monotone" dataKey="predicted" name="Predicted" stroke="#16a878" strokeWidth={2} dot={false} />
                            </LineChart>
                          </ResponsiveContainer>
                        ) : <div className="empty-chart">Not yet generated. No holdout prediction artifact was saved in the project.</div>}
                      </div>
                    </div>

                    <div className="panel visual-panel">
                      <div className="panel-heading"><div><h2>Forecast Horizon Visualization</h2><p>Future projection by day · future forecast</p></div></div>
                      <div className="chart-wrap compact-chart">
                        {methodology.chart_data?.forecast_horizon_data?.length ? (
                          <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={methodology.chart_data.forecast_horizon_data} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
                              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e9edf3" />
                              <XAxis dataKey="day" tick={{ fill: "#778196", fontSize: 10 }} tickLine={false} axisLine={false} />
                              <YAxis tick={{ fill: "#778196", fontSize: 10 }} tickLine={false} axisLine={false} width={42} />
                              <Tooltip formatter={(value) => [Number(value).toFixed(2), "Forecast"]} />
                              <Line type="monotone" dataKey="forecast" name="Forecast" stroke="#4c9a9a" strokeWidth={2.5} dot={{ r: 4 }} />
                            </LineChart>
                          </ResponsiveContainer>
                        ) : <div className="empty-chart">Not yet generated. The project does not include saved future forecast curves.</div>}
                      </div>
                    </div>

                    <div className="panel visual-panel">
                      <div className="panel-heading"><div><h2>Model Performance Comparison</h2><p>Validation performance for selected models · validation</p></div></div>
                      <div className="chart-wrap compact-chart">
                        {methodology.chart_data?.model_comparison?.length ? (
                          <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={methodology.chart_data.model_comparison} margin={{ top: 10, right: 12, left: -8, bottom: 0 }}>
                              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e9edf3" />
                              <XAxis dataKey="Model" tick={{ fill: "#778196", fontSize: 10 }} tickLine={false} axisLine={false} interval={0} angle={-20} textAnchor="end" height={56} />
                              <YAxis tick={{ fill: "#778196", fontSize: 10 }} tickLine={false} axisLine={false} />
                              <Tooltip formatter={(value, name) => [Number(value).toFixed(2), name]} />
                              <Bar dataKey="MAE" name="MAE" radius={[4, 4, 0, 0]} fill="#4776e6" />
                            </BarChart>
                          </ResponsiveContainer>
                        ) : <div className="empty-chart">Not yet generated.</div>}
                      </div>
                    </div>

                    <div className="panel visual-panel">
                      <div className="panel-heading"><div><h2>Residual/Error Analysis</h2><p>Prediction error distribution · validation/test</p></div></div>
                      <div className="chart-wrap compact-chart">
                        {methodology.chart_data?.residual_analysis?.length ? (
                          <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={methodology.chart_data.residual_analysis.slice(0, 200)} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
                              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e9edf3" />
                              <XAxis dataKey="date" tick={{ fill: "#778196", fontSize: 10 }} tickLine={false} axisLine={false} minTickGap={18} />
                              <YAxis tick={{ fill: "#778196", fontSize: 10 }} tickLine={false} axisLine={false} width={42} />
                              <Tooltip formatter={(value) => [Number(value).toFixed(2), "Residual"]} />
                              <Line type="monotone" dataKey="residual" name="Residual" stroke="#ef7b45" strokeWidth={2.2} dot={false} />
                            </LineChart>
                          </ResponsiveContainer>
                        ) : <div className="empty-chart">Not yet generated. No residuals file or error distribution artifact was saved.</div>}
                      </div>
                    </div>

                    <div className="panel visual-panel">
                      <div className="panel-heading"><div><h2>Feature Importance</h2><p>Influence of model inputs · not available</p></div></div>
                      <div className="chart-wrap compact-chart">
                        {methodology.chart_data?.feature_importance?.length ? (
                          <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={methodology.chart_data.feature_importance.slice(0, 10)} layout="vertical" margin={{ top: 10, right: 12, left: 10, bottom: 0 }}>
                              <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e9edf3" />
                              <XAxis type="number" tick={{ fill: "#778196", fontSize: 10 }} tickLine={false} axisLine={false} />
                              <YAxis type="category" dataKey="feature" width={110} tick={{ fill: "#536074", fontSize: 9 }} tickLine={false} axisLine={false} />
                              <Tooltip formatter={(value) => [Number(value).toFixed(4), "Importance"]} />
                              <Bar dataKey="importance" name="Importance" radius={[0, 4, 4, 0]} fill="#4776e6" />
                            </BarChart>
                          </ResponsiveContainer>
                        ) : <div className="empty-chart">Not yet generated. The project metadata does not include feature-importance values.</div>}
                      </div>
                    </div>
                  </div>
                </section>

                <section className="metric-grid methodology-eval-grid" aria-label="Model evaluation summary cards">
                  <MetricCard title="Selected Model" value={methodology.evaluation_summary.selected_model || "—"} subtitle="Best performing model on validation" icon={TrendingUp} />
                  <MetricCard title="Baseline Model" value={methodology.evaluation_summary.baseline_model || "—"} subtitle="Reference model" icon={BarChart3} />
                  <MetricCard title="MAE" value={typeof methodology.evaluation_summary.test_metrics?.MAE === "number" ? Number(methodology.evaluation_summary.test_metrics.MAE).toFixed(2) : "—"} subtitle="Held-out test set" icon={Activity} />
                  <MetricCard title="RMSE" value={typeof methodology.evaluation_summary.test_metrics?.RMSE === "number" ? Number(methodology.evaluation_summary.test_metrics.RMSE).toFixed(2) : "—"} subtitle="Held-out test set" icon={Activity} />
                  <MetricCard title="WAPE" value={typeof methodology.evaluation_summary.test_metrics?.WAPE === "number" ? Number(methodology.evaluation_summary.test_metrics.WAPE).toFixed(2) : "Not available"} subtitle="Saved project metrics" icon={BarChart3} />
                  <MetricCard title="Evaluation Period" value={methodology.evaluation_summary.evaluation_period || "—"} subtitle="Temporal test window" icon={CalendarDays} />
                </section>

                <section className="panel">
                  <div className="panel-heading"><div><h2>Section E: Training configuration</h2><p>Actual information available in the project artifacts</p></div></div>
                  <dl className="methodology-details compact">
                    <div><dt>Model algorithm</dt><dd>{methodology.training_configuration.model || "Unknown"}</dd></div>
                    <div><dt>Key hyperparameters</dt><dd>{methodology.training_configuration.best_parameters ? JSON.stringify(methodology.training_configuration.best_parameters) : "Not recorded"}</dd></div>
                    <div><dt>Training period</dt><dd>{methodology.training_configuration.train_start || "—"} to {methodology.training_configuration.train_end || "—"}</dd></div>
                    <div><dt>Validation period</dt><dd>{methodology.training_configuration.validation_start || "—"} to {methodology.training_configuration.validation_end || "—"}</dd></div>
                    <div><dt>Test period</dt><dd>{methodology.training_configuration.test_start || "—"} to {methodology.training_configuration.test_end || "—"}</dd></div>
                    <div><dt>Forecast horizon</dt><dd>{Number(methodology.training_configuration.test_end ? 7 : methodology.dataset.forecast_horizon || 7)} days</dd></div>
                    <div><dt>Feature engineering</dt><dd>{methodology.training_configuration.feature_engineering?.join("; ") || "Not recorded"}</dd></div>
                    <div><dt>Random seed</dt><dd>{methodology.training_configuration.random_seed || "Not recorded in saved metadata"}</dd></div>
                    <div><dt>Dataset version / timestamp</dt><dd>{methodology.training_configuration.training_timestamp || "Not recorded in saved metadata"}</dd></div>
                  </dl>
                </section>

                <section className="panel">
                  <div className="panel-heading"><div><h2>Section F: Key findings and limitations</h2><p>Evidence-based summary for presentation</p></div></div>
                  <div className="findings-structure">
                    <div>
                      <h3>Key findings</h3>
                      <ul>{methodology.findings?.map((item) => <li key={item}>{item}</li>)}</ul>
                    </div>
                    <div>
                      <h3>Known limitations</h3>
                      <ul>{methodology.limitations?.map((item) => <li key={item}>{item}</li>)}</ul>
                    </div>
                  </div>
                </section>
              </>
            )}
          </>
        )}

        <footer className="page-footer">
          <span>RetailSense · Historical retail demand analysis</span>
          <span>{model ? `Trained model metadata: ${model.model_type} · ${model.feature_count} features. Interactive forecasts use the ${forecastMethod}.` : "Model metadata unavailable; baseline forecasts remain separate."}</span>
        </footer>
      </main>

      {assistantOpen && (
        <section id="manager-chat" className="manager-chat" aria-label="Retail data assistant">
          <header className="manager-chat-header">
            <div className="assistant-identity">
              <span className="assistant-mark"><Bot size={18} /></span>
              <div><strong>Retail data assistant</strong><span>Rule-based answers from project data</span></div>
            </div>
            <button className="chat-close" type="button" aria-label="Close assistant" onClick={() => setAssistantOpen(false)}><X size={18} /></button>
          </header>

          <div className="assistant-scope">Selected context: {storeId || "No store"} · {productId || "No product"} · through {historyThrough || "date not loaded"}</div>

          <div className="manager-chat-log" role="log" aria-live="polite" ref={assistantLogRef}>
            {assistantMessages.map((message, index) => (
              <div className={`chat-message ${message.role}`} key={`${message.role}-${index}`}>
                {message.role === "assistant" && <span className="message-icon"><Bot size={14} /></span>}
                <p>{message.content}</p>
              </div>
            ))}
          </div>

          {assistantMessages.length === 1 && (
            <div className="assistant-prompts" aria-label="Suggested questions">
              <button type="button" onClick={(event) => sendAssistantMessage(event, "Summarize this product's recent demand")}>Product demand</button>
              <button type="button" onClick={(event) => sendAssistantMessage(event, "What is the forecast outlook?")}>Forecast outlook</button>
              <button type="button" onClick={(event) => sendAssistantMessage(event, "Which category has the highest demand?")}>Top category</button>
            </div>
          )}

          <form className="manager-chat-form" onSubmit={sendAssistantMessage}>
            <label className="sr-only" htmlFor="manager-chat-input">Ask about products and insights</label>
            <input id="manager-chat-input" value={assistantInput} onChange={(event) => setAssistantInput(event.target.value)} placeholder="Ask about demand, stock, stores..." autoComplete="off" />
            <button type="submit" aria-label="Send message" disabled={!assistantInput.trim()}><Send size={17} /></button>
          </form>
          <div className="assistant-disclaimer">Historical insights only. Forecasts use the moving-average baseline.</div>
        </section>
      )}

      <button className={`assistant-launcher ${assistantOpen ? "is-open" : ""}`} type="button" aria-label={assistantOpen ? "Close retail data assistant" : "Open retail data assistant"} aria-expanded={assistantOpen} aria-controls="manager-chat" onClick={() => setAssistantOpen((open) => !open)}>
        {assistantOpen ? <X size={21} /> : <MessageCircle size={21} />}
      </button>
    </div>
  );
}
