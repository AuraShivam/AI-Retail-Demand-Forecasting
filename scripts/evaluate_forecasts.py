from __future__ import annotations

import json
from math import sqrt
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score


ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data" / "processed"
MODEL_DIR = ROOT / "models"
RESULTS_DIR = ROOT / "reports" / "model_results"
GROUP_COLUMNS = ["Store ID", "Product ID"]
KEY_COLUMNS = ["Date", *GROUP_COLUMNS]
HORIZON = 7


def _metrics(actual: np.ndarray, predicted: np.ndarray) -> dict[str, float]:
    denominator = np.abs(actual) + np.abs(predicted)
    valid = denominator > 0
    smape = (
        float(np.mean(200 * np.abs(actual[valid] - predicted[valid]) / denominator[valid]))
        if valid.any()
        else 0.0
    )
    return {
        "MAE": float(mean_absolute_error(actual, predicted)),
        "RMSE": float(sqrt(mean_squared_error(actual, predicted))),
        "sMAPE": smape,
        "R2": float(r2_score(actual, predicted)),
        "rows": int(len(actual)),
    }


def _season(date: pd.Timestamp) -> str:
    if date.month in (12, 1, 2):
        return "Winter"
    if date.month in (3, 4, 5):
        return "Spring"
    if date.month in (6, 7, 8):
        return "Summer"
    return "Autumn"


def _future_row(
    history: pd.DataFrame,
    demand_history: list[float],
    forecast_date: pd.Timestamp,
) -> dict:
    last = history.iloc[-1]
    row = {
        "Store ID": last["Store ID"],
        "Product ID": last["Product ID"],
        "Category": last["Category"],
        "Region": last["Region"],
        "Seasonality": _season(forecast_date),
        "Year": forecast_date.year,
        "Month": forecast_date.month,
        "Quarter": forecast_date.quarter,
        "DayOfMonth": forecast_date.day,
        "DayOfWeek": forecast_date.dayofweek,
        "WeekOfYear": int(forecast_date.isocalendar().week),
        "IsWeekend": int(forecast_date.dayofweek >= 5),
        "DayOfWeek_Sin": np.sin(2 * np.pi * forecast_date.dayofweek / 7),
        "DayOfWeek_Cos": np.cos(2 * np.pi * forecast_date.dayofweek / 7),
        "Month_Sin": np.sin(2 * np.pi * (forecast_date.month - 1) / 12),
        "Month_Cos": np.cos(2 * np.pi * (forecast_date.month - 1) / 12),
    }

    for lag in (1, 7, 14, 30):
        row[f"Lag_{lag}"] = demand_history[-lag]
    for window in (7, 14, 30):
        recent = np.asarray(demand_history[-window:], dtype=float)
        row[f"RollingMean_{window}"] = float(recent.mean())
        row[f"RollingStd_{window}"] = float(recent.std(ddof=1))
    row["RollingMin_7"] = min(demand_history[-7:])
    row["RollingMax_7"] = max(demand_history[-7:])
    row["RollingMin_30"] = min(demand_history[-30:])
    row["RollingMax_30"] = max(demand_history[-30:])

    for feature, source, lag in (
        ("Inventory_Lag_1", "Inventory Level", 1),
        ("Inventory_Lag_7", "Inventory Level", 7),
        ("UnitsSold_Lag_1", "Units Sold", 1),
        ("UnitsSold_Lag_7", "Units Sold", 7),
        ("UnitsSold_Lag_14", "Units Sold", 14),
        ("UnitsOrdered_Lag_1", "Units Ordered", 1),
        ("UnitsOrdered_Lag_7", "Units Ordered", 7),
        ("UnitsOrdered_Lag_14", "Units Ordered", 14),
    ):
        row[feature] = float(history[source].iloc[-lag])
    row["Price_Lag_1"] = float(last["Price"])
    row["CompetitorPrice_Lag_1"] = float(last["Competitor Pricing"])
    return row


def _recursive_test_predictions(
    safe_model,
    safe_features: list[str],
    historical: pd.DataFrame,
    test: pd.DataFrame,
) -> pd.DataFrame:
    groups = {
        (str(store_id), str(product_id)): group.sort_values("Date").reset_index(drop=True)
        for (store_id, product_id), group in historical.groupby(GROUP_COLUMNS, sort=False)
    }
    test_dates = sorted(test["Date"].unique())
    if len(test_dates) <= HORIZON:
        raise ValueError("The held-out test period must contain more than seven dates.")
    if pd.Series(test_dates).diff().dropna().dt.days.ne(1).any():
        raise ValueError("The test period must contain consecutive daily dates.")

    actuals = {
        (pd.Timestamp(date), str(store_id), str(product_id)): float(demand)
        for date, store_id, product_id, demand in test[
            ["Date", "Store ID", "Product ID", "Demand"]
        ].itertuples(index=False, name=None)
    }

    output = []
    origins = [pd.Timestamp(date) for date in test_dates]
    origins.insert(0, pd.Timestamp(test_dates[0]) - pd.Timedelta(days=1))

    for origin in origins:
        states = []
        feature_rows = []
        for series_key, group in groups.items():
            end = int(group["Date"].searchsorted(origin, side="right"))
            history = group.iloc[:end]
            if len(history) < 30:
                continue
            states.append(
                {
                    "key": series_key,
                    "history": history,
                    "demand": history["Demand"].astype(float).tolist(),
                    "baseline_demand": history["Demand"].astype(float).tolist(),
                }
            )

        for step in range(1, HORIZON + 1):
            forecast_date = origin + pd.Timedelta(days=step)
            rows = [
                _future_row(state["history"], state["demand"], forecast_date)
                for state in states
            ]
            model_predictions = np.maximum(
                0.0,
                safe_model.predict(pd.DataFrame(rows)[safe_features]).astype(float),
            )

            for state, row, model_prediction in zip(states, rows, model_predictions):
                baseline_prediction = max(
                    0.0, float(np.mean(state["baseline_demand"][-7:]))
                )
                series_key = state["key"]
                actual = actuals.get((forecast_date, *series_key))
                if actual is not None:
                    output.append(
                        {
                            "origin_date": origin.strftime("%Y-%m-%d"),
                            "date": forecast_date.strftime("%Y-%m-%d"),
                            "store_id": series_key[0],
                            "product_id": series_key[1],
                            "horizon": step,
                            "actual": actual,
                            "xgboost_predicted": float(model_prediction),
                            "moving_average_predicted": baseline_prediction,
                        }
                    )
                state["demand"].append(float(model_prediction))
                state["baseline_demand"].append(baseline_prediction)

    return pd.DataFrame(output)


def main() -> None:
    metadata = json.loads((MODEL_DIR / "model_metadata.json").read_text(encoding="utf-8"))
    safe_metadata = json.loads(
        (MODEL_DIR / "xgboost_7day_safe_metadata.json").read_text(encoding="utf-8")
    )
    selected_model = joblib.load(MODEL_DIR / "best_demand_model.pkl")
    safe_model = joblib.load(MODEL_DIR / "xgboost_7day_safe.pkl")
    train = pd.read_csv(DATA_DIR / "train.csv", parse_dates=["Date"])
    test = pd.read_csv(DATA_DIR / "test.csv", parse_dates=["Date"])
    historical = pd.read_csv(DATA_DIR / "cleaned_sales_data.csv", parse_dates=["Date"])

    selected_features = metadata["categorical_features"] + metadata["numerical_features"]
    safe_features = safe_metadata["features"]
    for label, frame, features in (
        ("selected model", test, selected_features),
        ("7-day model", test, safe_features),
    ):
        missing = sorted(set(features) - set(frame.columns))
        if missing:
            raise ValueError(f"{label} is missing feature columns: {missing}")
    raw_history_columns = [
        *GROUP_COLUMNS,
        "Date",
        "Demand",
        "Category",
        "Region",
        "Inventory Level",
        "Units Sold",
        "Units Ordered",
        "Price",
        "Competitor Pricing",
    ]
    missing_history_columns = sorted(set(raw_history_columns) - set(historical.columns))
    if missing_history_columns:
        raise ValueError(f"Cleaned history is missing source columns: {missing_history_columns}")
    if len(selected_features) != metadata["number_of_features"]:
        raise ValueError("Selected model feature list does not match saved metadata.")
    if test[KEY_COLUMNS].isna().any().any() or test["Demand"].isna().any():
        raise ValueError("Test keys and targets must be complete for aligned evaluation.")
    if test.duplicated(KEY_COLUMNS).any():
        raise ValueError("Test data contains duplicate store-product-date rows.")
    if test["Date"].min().strftime("%Y-%m-%d") != metadata["test_start"]:
        raise ValueError("Test start date does not match saved model metadata.")
    if test["Date"].max().strftime("%Y-%m-%d") != metadata["test_end"]:
        raise ValueError("Test end date does not match saved model metadata.")

    target = test["Demand"].to_numpy(dtype=float)
    full_predictions = np.maximum(
        0.0, selected_model.predict(test[selected_features]).astype(float)
    )
    train_mean = float(train["Demand"].mean())
    one_step = pd.DataFrame(
        {
            "date": test["Date"].dt.strftime("%Y-%m-%d"),
            "store_id": test["Store ID"].astype(str),
            "product_id": test["Product ID"].astype(str),
            "actual": target,
            "xgboost_53_feature": full_predictions,
            "moving_average_7day": test["RollingMean_7"].to_numpy(dtype=float),
            "training_mean": train_mean,
        }
    )
    conditional_metrics = {
        "test_period": [metadata["test_start"], metadata["test_end"]],
        "rows": int(len(test)),
        "unique_series": int(test[GROUP_COLUMNS].drop_duplicates().shape[0]),
        "comparison_horizon_days": 1,
        "alignment": "Same 11,000 test rows keyed by date, store, and product; no duplicate keys or missing targets.",
        "qualification": (
            "Conditional one-step diagnostic only. The selected 53-feature model uses same-date "
            "Inventory Level, Price, Discount, Competitor Pricing, Weather Condition, Promotion, "
            "and Epidemic fields; their availability before demand is not established."
        ),
        "metrics": {
            "saved_xgboost_53_feature": _metrics(target, full_predictions),
            "7_day_moving_average_one_step": _metrics(
                target, one_step["moving_average_7day"].to_numpy(dtype=float)
            ),
            "training_mean_baseline": _metrics(
                target, np.full(len(test), train_mean, dtype=float)
            ),
        },
    }

    recursive = _recursive_test_predictions(
        safe_model, safe_features, historical, test
    )
    horizon_one = recursive.loc[recursive["horizon"] == 1].copy()
    horizon_one = horizon_one.rename(
        columns={"store_id": "Store ID", "product_id": "Product ID"}
    )
    horizon_one["Date"] = pd.to_datetime(horizon_one["date"])
    aligned_one_step = test.merge(
        horizon_one,
        on=["Date", *GROUP_COLUMNS],
        how="inner",
        validate="one_to_one",
        suffixes=("_test", "_recursive"),
    )
    if len(aligned_one_step) != len(test):
        raise ValueError("Reconstructed one-step predictions do not cover every test row exactly once.")
    direct_safe_predictions = np.maximum(
        0.0, safe_model.predict(test[safe_features]).astype(float)
    )
    if not np.allclose(
        direct_safe_predictions,
        aligned_one_step["xgboost_predicted"].to_numpy(dtype=float),
        rtol=1e-6,
        atol=1e-5,
    ):
        raise ValueError(
            "Recursive one-step feature construction differs from saved test features; "
            "do not use the multi-horizon comparison until aligned."
        )
    feature_reconstruction_max_abs_error = float(
        np.max(
            np.abs(
                direct_safe_predictions
                - aligned_one_step["xgboost_predicted"].to_numpy(dtype=float)
            )
        )
    )
    horizon_metrics = []
    for horizon, rows in recursive.groupby("horizon", sort=True):
        actual = rows["actual"].to_numpy(dtype=float)
        horizon_metrics.append(
            {
                "horizon": int(horizon),
                "xgboost": _metrics(actual, rows["xgboost_predicted"].to_numpy(dtype=float)),
                "moving_average": _metrics(
                    actual, rows["moving_average_predicted"].to_numpy(dtype=float)
                ),
            }
        )
    pooled = {
        "xgboost": _metrics(
            recursive["actual"].to_numpy(dtype=float),
            recursive["xgboost_predicted"].to_numpy(dtype=float),
        ),
        "moving_average": _metrics(
            recursive["actual"].to_numpy(dtype=float),
            recursive["moving_average_predicted"].to_numpy(dtype=float),
        ),
    }
    recursive_summary = {
        "test_period": [metadata["test_start"], metadata["test_end"]],
        "forecast_horizon_days": HORIZON,
        "forecast_origins": int(recursive["origin_date"].nunique()),
        "unique_series": int(test[GROUP_COLUMNS].drop_duplicates().shape[0]),
        "prediction_rows": int(len(recursive)),
        "one_step_feature_reconstruction": {
            "matched_test_rows": int(len(aligned_one_step)),
            "max_absolute_prediction_difference": feature_reconstruction_max_abs_error,
            "within_tolerance": True,
        },
        "alignment": (
            "At each rolling origin, saved leakage-reduced XGBoost and recursive 7-day moving average "
            "are scored on identical date/store/product/horizon targets. Future actual demand is not "
            "used inside either forecast path."
        ),
        "feature_assumptions": (
            "Calendar features are known; demand lags update recursively from predictions; operational "
            "lag features (inventory, units sold/ordered, price) are held at the last observed history."
        ),
        "pooled_metrics_over_all_horizons": pooled,
        "metrics_by_horizon": horizon_metrics,
    }

    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    one_step.to_csv(RESULTS_DIR / "test_next_day_conditional_comparison.csv", index=False)
    recursive.to_csv(RESULTS_DIR / "test_7day_rolling_origin_predictions.csv", index=False)
    report = {
        "conditional_next_day_comparison": conditional_metrics,
        "rolling_origin_7day_comparison": recursive_summary,
    }
    (RESULTS_DIR / "forecast_test_evaluation.json").write_text(
        json.dumps(report, indent=2), encoding="utf-8"
    )
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()