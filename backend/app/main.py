
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi import HTTPException
from backend.app.services.data_service import (
    get_dashboard_summary,
    get_stores,
    get_products,
)
from backend.app.services.model_service import get_model_status
from backend.app.services.model_service import get_model_methodology
from backend.app.services.forecast_service import get_series_history
from backend.app.services.forecast_service import generate_forecast
from backend.app.services.data_service import get_product_catalog
from backend.app.services.data_service import get_store_analytics
from backend.app.services.data_service import get_analytics_overview

app = FastAPI(
    title="Retail Demand Forecasting API",
    description="Demand forecasting and inventory optimization platform",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
def root():
    return {
        "message": "Retail Demand Forecasting API is running",
        "status": "ok",
    }


@app.get("/api/health")
def health_check():
    return {"status": "healthy"}

@app.get("/api/dashboard/summary")
def dashboard_summary():
    return get_dashboard_summary()


@app.get("/api/stores")
def stores():
    return {"stores": get_stores()}


@app.get("/api/products")
def products(store_id: str | None = None):
    return {"products": get_products(store_id)}


@app.get("/api/model/status")
def model_status():
    return get_model_status()

@app.get("/api/model/methodology")
def model_methodology():
    return get_model_methodology()

@app.get("/api/forecast/history")
def forecast_history(store_id: str, product_id: str):
    try:
        return get_series_history(store_id, product_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    
@app.get("/api/forecast")
def forecast(store_id: str, product_id: str, horizon: int = 7):
    try:
        return generate_forecast(store_id, product_id, horizon)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/api/product-catalog")
def product_catalog(store_id: str | None = None):
    return {"products": get_product_catalog(store_id)}


@app.get("/api/analytics/stores")
def store_analytics():
    return {"stores": get_store_analytics()}


@app.get("/api/analytics/overview")
def analytics_overview(store_id: str | None = None):
    return get_analytics_overview(store_id)
