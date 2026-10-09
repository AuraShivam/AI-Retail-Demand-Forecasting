
from pathlib import Path

import pandas as pd

# Project root: folder containing backend/, data/, and models/
PROJECT_ROOT = Path(__file__).resolve().parents[3]
DATA_PATH = PROJECT_ROOT / "data" / "processed" / "cleaned_sales_data.csv"


def load_retail_data() -> pd.DataFrame:
    """Load the cleaned retail dataset."""
    if not DATA_PATH.exists():
        raise FileNotFoundError(
            f"Cleaned dataset not found at: {DATA_PATH}"
        )

    df = pd.read_csv(DATA_PATH)
    df["Date"] = pd.to_datetime(df["Date"], errors="coerce")
    return df


def get_dashboard_summary() -> dict:
    """Return high-level statistics for the dashboard."""
    df = load_retail_data()

    return {
        "total_records": int(len(df)),
        "total_stores": int(df["Store ID"].nunique()),
        "total_products": int(df["Product ID"].nunique()),
        "average_demand": round(float(df["Demand"].mean()), 2),
        "total_demand": int(df["Demand"].sum()),
        "date_start": df["Date"].min().strftime("%Y-%m-%d"),
        "date_end": df["Date"].max().strftime("%Y-%m-%d"),
    }


def get_stores() -> list[str]:
    """Return available store IDs."""
    df = load_retail_data()
    return sorted(df["Store ID"].dropna().astype(str).unique().tolist())


def get_products(store_id: str | None = None) -> list[str]:
    """Return available product IDs, optionally filtered by store."""
    df = load_retail_data()

    if store_id:
        df = df[df["Store ID"].astype(str) == store_id]

    return sorted(df["Product ID"].dropna().astype(str).unique().tolist())


def get_product_catalog(store_id: str | None = None) -> list[dict]:
    df = load_retail_data()

    if store_id:
        df = df[df["Store ID"].astype(str) == store_id]

    catalog = (
        df[["Product ID", "Category"]]
        .dropna(subset=["Product ID"])
        .drop_duplicates()
        .sort_values("Product ID")
    )

    return [
        {
            "product_id": str(row["Product ID"]),
            "category": str(row["Category"]),
            "label": f'{row["Product ID"]} — {row["Category"]}',
        }
        for _, row in catalog.iterrows()
    ]


def get_store_analytics() -> list[dict]:
    df = load_retail_data()

    analytics = (
        df.groupby("Store ID")
        .agg(
            total_demand=("Demand", "sum"),
            average_demand=("Demand", "mean"),
            total_records=("Demand", "count"),
            total_products=("Product ID", "nunique"),
        )
        .reset_index()
        .sort_values("Store ID")
    )

    return [
        {
            "store_id": str(row["Store ID"]),
            "total_demand": int(row["total_demand"]),
            "average_demand": round(float(row["average_demand"]), 2),
            "total_records": int(row["total_records"]),
            "total_products": int(row["total_products"]),
        }
        for _, row in analytics.iterrows()
    ]


def get_analytics_overview(store_id: str | None = None) -> dict:
    """Return historical aggregates for the analytics dashboard."""
    df = load_retail_data()

    if store_id:
        df = df[df["Store ID"].astype(str) == store_id]

    if df.empty:
        return {
            "store_id": store_id,
            "record_count": 0,
            "monthly_demand": [],
            "category_demand": [],
            "promotion_comparison": [],
            "seasonality_demand": [],
            "demand_distribution": [],
        }

    monthly = (
        df.assign(month=df["Date"].dt.to_period("M").astype(str))
        .groupby("month")
        .agg(
            total_demand=("Demand", "sum"),
            average_demand=("Demand", "mean"),
            record_count=("Demand", "count"),
        )
        .reset_index()
    )
    categories = (
        df.groupby("Category")
        .agg(
            total_demand=("Demand", "sum"),
            average_demand=("Demand", "mean"),
            record_count=("Demand", "count"),
        )
        .reset_index()
        .sort_values("average_demand", ascending=False)
    )
    promotions = (
        df.groupby("Promotion")
        .agg(average_demand=("Demand", "mean"), record_count=("Demand", "count"))
        .reset_index()
    )
    seasons = (
        df.groupby("Seasonality")
        .agg(average_demand=("Demand", "mean"), record_count=("Demand", "count"))
        .reset_index()
        .sort_values("Seasonality")
    )
    distribution = (
        df.assign(
            demand_band=pd.cut(
                df["Demand"],
                bins=[0, 50, 100, 150, 200, 250, 300, float("inf")],
                labels=["0-49", "50-99", "100-149", "150-199", "200-249", "250-299", "300+"],
                right=False,
            )
        )
        .groupby("demand_band", observed=False)
        .agg(record_count=("Demand", "count"))
        .reset_index()
    )

    return {
        "store_id": store_id,
        "record_count": int(len(df)),
        "monthly_demand": [
            {
                "month": row.month,
                "total_demand": int(row.total_demand),
                "average_demand": round(float(row.average_demand), 2),
                "record_count": int(row.record_count),
            }
            for row in monthly.itertuples(index=False)
        ],
        "category_demand": [
            {
                "category": row.Category,
                "total_demand": int(row.total_demand),
                "average_demand": round(float(row.average_demand), 2),
                "record_count": int(row.record_count),
            }
            for row in categories.itertuples(index=False)
        ],
        "promotion_comparison": [
            {
                "promotion": "Promotion" if int(row.Promotion) else "No promotion",
                "average_demand": round(float(row.average_demand), 2),
                "record_count": int(row.record_count),
            }
            for row in promotions.itertuples(index=False)
        ],
        "seasonality_demand": [
            {
                "seasonality": row.Seasonality,
                "average_demand": round(float(row.average_demand), 2),
                "record_count": int(row.record_count),
            }
            for row in seasons.itertuples(index=False)
        ],
        "demand_distribution": [
            {
                "band": str(row.demand_band),
                "record_count": int(row.record_count),
            }
            for row in distribution.itertuples(index=False)
        ],
    }
