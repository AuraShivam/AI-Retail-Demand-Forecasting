
from backend.app.services.data_service import load_retail_data


def get_series_history(store_id: str, product_id: str) -> dict:
    """Return the latest historical observations for a store/product."""
    df = load_retail_data()

    series = df[
        (df["Store ID"].astype(str) == store_id)
        & (df["Product ID"].astype(str) == product_id)
    ].sort_values("Date")

    if series.empty:
        raise ValueError(
            f"No data found for store {store_id} and product {product_id}"
        )

    history = series.tail(30)

    return {
        "store_id": store_id,
        "product_id": product_id,
        "latest_date": history["Date"].max().strftime("%Y-%m-%d"),
        "observations": [
            {
                "date": row["Date"].strftime("%Y-%m-%d"),
                "demand": float(row["Demand"]),
                "inventory_level": float(row["Inventory Level"]),
            }
            for _, row in history.iterrows()
        ],
    }


def generate_forecast(store_id: str, product_id: str, horizon: int = 7) -> dict:
    """Generate a baseline forecast using the latest seven demand values."""
    if not 1 <= horizon <= 30:
        raise ValueError("Horizon must be between 1 and 30 days.")

    from datetime import timedelta
    import pandas as pd

    df = load_retail_data()

    series = df[
        (df["Store ID"].astype(str) == store_id)
        & (df["Product ID"].astype(str) == product_id)
    ].sort_values("Date")

    if series.empty:
        raise ValueError(
            f"No data found for store {store_id} and product {product_id}"
        )

    series = series.dropna(subset=["Date", "Demand"])
    if len(series) < 7:
        raise ValueError("At least seven historical demand observations are required.")

    demand_history = series["Demand"].astype(float).tolist()
    latest_date = pd.Timestamp(series["Date"].iloc[-1])
    forecast_rows = []

    for step in range(1, horizon + 1):
        prediction = max(0.0, sum(demand_history[-7:]) / 7.0)
        forecast_date = latest_date + timedelta(days=step)

        forecast_rows.append({
            "date": forecast_date.strftime("%Y-%m-%d"),
            "forecast_horizon": step,
            "predicted_demand": round(prediction, 2),
        })

        # Recursive moving average: use the predicted value for future steps.
        demand_history.append(prediction)

    return {
        "store_id": store_id,
        "product_id": product_id,
        "forecast_method": "7-day moving-average baseline",
        "history_through": latest_date.strftime("%Y-%m-%d"),
        "forecast": forecast_rows,
    }
