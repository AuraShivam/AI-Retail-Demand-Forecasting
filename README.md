# AI Retail Demand Forecasting.

A retail demand forecasting project with a React dashboard, a FastAPI backend,
historical demand analytics, model evaluation artifacts, and an inventory
replenishment calculation.

## Project layout

- `backend/` - FastAPI application, data/model services, and tests.
- `frontend/` - React 19 dashboard built with Vite.
- `data/` - raw and processed retail datasets used by the application and
  analysis.
- `models/` - saved model and metadata artifacts.
- `notebooks/` - data understanding, cleaning, feature engineering, training,
  and forecast-validation notebooks.
- `reports/model_results/` - evaluation outputs used by the methodology view.
- `docs/inventory_data_and_assumptions.md` - inventory data limitations and
  replenishment input assumptions.

## Requirements

- Python 3.10 or newer
- Node.js and npm

Install Python runtime dependencies from the repository root:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
```

For tests and notebook work, install the additional development dependencies:

```powershell
python -m pip install -r requirements-dev.txt
```

## Run locally

Start the API from the repository root:

```powershell
python -m uvicorn backend.app.main:app --reload
```

The API is available at `http://localhost:8000`; interactive API documentation
is at `http://localhost:8000/docs`.

In a second terminal, install and start the dashboard:

```powershell
cd frontend
npm install
npm run dev
```

Open the Vite URL shown in the terminal (normally
`http://localhost:5173`). The frontend expects the API at
`http://localhost:8000`, and the backend CORS configuration allows that Vite
origin.

## API routes

- `GET /api/health` - health check.
- `GET /api/dashboard/summary` - overall historical dataset summary.
- `GET /api/stores` and `GET /api/products` - store/product selectors.
- `GET /api/forecast/history?store_id=...&product_id=...` - recent history.
- `GET /api/forecast?store_id=...&product_id=...&horizon=7` - forecast for 1
  to 30 days.
- `GET /api/analytics/overview` and `GET /api/analytics/stores` - historical
  analytics.
- `GET /api/model/status` and `GET /api/model/methodology` - saved model
  metadata and evaluation details.

## Forecast and inventory notes

Although the repository contains a trained model and evaluation artifacts, the
live `/api/forecast` route currently returns a recursive seven-day
moving-average baseline; it does not use the trained XGBoost model. Forecasts
should be interpreted accordingly.

The replenishment calculation is a standalone service that requires callers to
provide operational inputs such as lead time, on-hand stock, a target stock
level, and either forecast-error standard deviation or fallback safety stock.
Historical inventory and order records are not live stock or open purchase
orders. See
[`docs/inventory_data_and_assumptions.md`](docs/inventory_data_and_assumptions.md)
for the full assumptions and limitations.

## Tests

From the repository root, after installing `requirements-dev.txt`:

```powershell
python -m pytest backend/tests
```

## Frontend checks

From `frontend/`:

```powershell
npm run lint
npm run build
```
