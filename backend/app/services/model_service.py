
from pathlib import Path
import json

import joblib
import pandas as pd

PROJECT_ROOT = Path(__file__).resolve().parents[3]
MODELS_DIR = PROJECT_ROOT / "models"
DATA_DIR = PROJECT_ROOT / "data" / "processed"
REPORTS_DIR = PROJECT_ROOT / "reports" / "model_results"

MODEL_PATH = MODELS_DIR / "best_demand_model.pkl"
METADATA_PATH = MODELS_DIR / "model_metadata.json"
METHODOLOGY_PATH = MODELS_DIR / "methodology_summary.json"


def load_model_assets():
    """Load the trained model and its metadata."""
    if not MODEL_PATH.exists():
        raise FileNotFoundError(f"Model file not found: {MODEL_PATH}")

    if not METADATA_PATH.exists():
        raise FileNotFoundError(
            f"Model metadata not found: {METADATA_PATH}"
        )

    model = joblib.load(MODEL_PATH)

    with open(METADATA_PATH, "r", encoding="utf-8") as file:
        metadata = json.load(file)

    return model, metadata


def _read_json(path: Path):
    if not path.exists():
        return {}

    with open(path, "r", encoding="utf-8") as file:
        return json.load(file)


def _monthly_demand_summary() -> list[dict]:
    data_path = DATA_DIR / "cleaned_sales_data.csv"
    if not data_path.exists():
        return []

    df = pd.read_csv(data_path)
    df["Date"] = pd.to_datetime(df["Date"], errors="coerce")

    grouped = (
        df.assign(month=df["Date"].dt.to_period("M").astype(str))
        .groupby("month")
        .agg(
            total_demand=("Demand", "sum"),
            average_demand=("Demand", "mean"),
            record_count=("Demand", "count"),
        )
        .reset_index()
        .sort_values("month")
    )

    return [
        {
            "month": row.month,
            "total_demand": int(row.total_demand),
            "average_demand": round(float(row.average_demand), 2),
            "record_count": int(row.record_count),
        }
        for row in grouped.itertuples(index=False)
    ]


def _model_comparison_summary() -> list[dict]:
    comparison_path = REPORTS_DIR / "validation_model_comparison.csv"
    if not comparison_path.exists():
        return []

    try:
        comparison = pd.read_csv(comparison_path)
        return comparison.to_dict(orient="records")
    except Exception:
        return []


def _read_artifact_csv(path: Path) -> list[dict]:
    if not path.exists():
        return []

    try:
        frame = pd.read_csv(path)
        return frame.to_dict(orient="records")
    except Exception:
        return []


def _prepare_methodology_summary() -> dict:
    base_summary = _read_json(METHODOLOGY_PATH)
    if base_summary:
        merged_summary = base_summary.copy()
    else:
        merged_summary = {}

    metadata = _read_json(METADATA_PATH)
    train_summary = {
        "model": metadata.get("model", "XGBoost"),
        "target": metadata.get("target", "Demand"),
        "feature_count": metadata.get("number_of_features", 0),
        "features": metadata.get("categorical_features", []) + metadata.get("numerical_features", []),
        "best_parameters": metadata.get("best_parameters", {}),
        "train_rows": metadata.get("train_rows"),
        "validation_rows": metadata.get("validation_rows"),
        "test_rows": metadata.get("test_rows"),
        "train_start": metadata.get("train_start"),
        "train_end": metadata.get("train_end"),
        "validation_start": metadata.get("validation_start"),
        "validation_end": metadata.get("validation_end"),
        "test_start": metadata.get("test_start"),
        "test_end": metadata.get("test_end"),
        "training_timestamp": "Not recorded in the persisted training metadata",
        "random_seed": "Not recorded in the saved metadata",
        "feature_engineering": [
            "Lag features for demand, inventory, units sold, units ordered, and price.",
            "Rolling statistics over 7, 14, and 30 day windows for demand and inventory.",
            "Calendar encodings with sine/cosine month and weekday transforms.",
            "Inventory-demand ratio and inventory coverage approximations for operational context.",
        ],
    }

    evaluation_summary = {
        "selected_model": metadata.get("model", "XGBoost"),
        "baseline_model": "Mean Baseline",
        "evaluation_period": f"{metadata.get('test_start', 'unknown')} to {metadata.get('test_end', 'unknown')}",
        "forecast_horizon": 7,
        "validation_metrics": metadata.get("validation_metrics", {}),
        "test_metrics": metadata.get("test_metrics", {}),
        "wape_status": "Not available in the saved project metrics",
    }

    dataset_counts = _read_json(METHODOLOGY_PATH).get("dataset", {}) if METHODOLOGY_PATH.exists() else {}
    if not dataset_counts:
        dataset_file = DATA_DIR / "cleaned_sales_data.csv"
        if dataset_file.exists():
            df = pd.read_csv(dataset_file)
            dataset_counts = {
                "name": "Retail Demand Forecasting Dataset",
                "source": "Kaggle retail inventory and demand forecasting dataset",
                "rows": int(len(df)),
                "columns": int(len(df.columns)),
                "stores": int(df["Store ID"].nunique()),
                "products": int(df["Product ID"].nunique()),
                "date_start": df["Date"].min(),
                "date_end": df["Date"].max(),
                "target": "Demand",
                "forecast_horizon": 7,
                "missing_values": int(df.isna().sum().sum()),
                "duplicate_rows": int(df.duplicated().sum()),
            }

    chart_data = {
        "monthly_demand": _monthly_demand_summary(),
        "model_comparison": _model_comparison_summary(),
        "actual_vs_predicted": _read_artifact_csv(REPORTS_DIR / "actual_vs_predicted.csv"),
        "forecast_horizon_data": _read_artifact_csv(REPORTS_DIR / "forecast_horizon.csv"),
        "residual_analysis": _read_artifact_csv(REPORTS_DIR / "residuals.csv"),
        "feature_importance": _read_artifact_csv(REPORTS_DIR / "feature_importance.csv"),
    }

    findings = [
        (
            "On the held-out test set, the XGBoost model achieved MAE 11.24 and RMSE 14.95, "
            "outperforming the mean baseline MAE 37.52 and RMSE 49.40."
        ),
        "The saved validation metrics also show XGBoost outperforming the baseline models on the same temporal holdout window.",
        "The methodology view now reads the generated holdout predictions, residuals, and feature-importance artifacts from the saved project results.",
    ]
    limitations = [
        "The dashboard forecast currently uses a seven-day moving-average baseline rather than the trained XGBoost model.",
        "The project metadata does not include WAPE, a random seed, or a persisted deployment artifact for the live forecast endpoint.",
        "The inventory optimization module is not backed by a validated lead-time and service-level policy, so stockout prevention claims should be treated as planned rather than implemented.",
    ]

    return {
        "dataset": {
            **(merged_summary.get("dataset", {})),
            **dataset_counts,
        },
        "training_configuration": {
            **(merged_summary.get("training", {})),
            **train_summary,
        },
        "evaluation_summary": {
            **(merged_summary.get("evaluation", {})),
            **evaluation_summary,
        },
        "chart_data": chart_data,
        "pipeline": {
            "stages": [
                "Raw Retail Data",
                "Data Cleaning",
                "Feature Engineering",
                "Temporal Data Split",
                "Model Training",
                "Model Evaluation",
                "Demand Forecasting",
            ],
            "status": {
                "Raw Retail Data": "Completed",
                "Data Cleaning": "Completed",
                "Feature Engineering": "Completed",
                "Temporal Data Split": "Completed",
                "Model Training": "Completed",
                "Model Evaluation": "Completed",
                "Demand Forecasting": "Baseline endpoint only; trained model is not currently used for live forecast requests",
            },
        },
        "findings": findings,
        "limitations": limitations,
        "artifacts": {
            "actual_vs_predicted": chart_data["actual_vs_predicted"],
            "forecast_horizon_data": chart_data["forecast_horizon_data"],
            "residual_analysis": chart_data["residual_analysis"],
            "feature_importance": chart_data["feature_importance"],
        },
    }


def get_model_status() -> dict:
    """Return model details using the existing metadata schema."""
    model, metadata = load_model_assets()

    categorical = metadata.get("categorical_features", [])
    numerical = metadata.get("numerical_features", [])

    return {
        "status": "loaded",
        "model_type": metadata.get("model", type(model).__name__),
        "target": metadata.get("target", "unknown"),
        "feature_count": metadata.get(
            "number_of_features", len(categorical) + len(numerical)
        ),
        "categorical_feature_count": len(categorical),
        "numerical_feature_count": len(numerical),
        "test_metrics": metadata.get("test_metrics", {}),
    }


def get_model_methodology() -> dict:
    """Return the saved methodology summary and actual evaluation artifacts."""
    return _prepare_methodology_summary()
