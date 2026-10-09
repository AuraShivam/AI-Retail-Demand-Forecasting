"""Pure replenishment calculations; callers supply live stock and policy assumptions."""

from __future__ import annotations

import math
from collections.abc import Sequence
from statistics import NormalDist


def recommend_replenishment(
    forecast_demand: Sequence[float],
    lead_time_days: int,
    on_hand: float,
    target_stock_level: float,
    *,
    outstanding_orders: float | None = None,
    backorders: float | None = None,
    forecast_error_std: float | None = None,
    fallback_safety_stock: float | None = None,
    service_level: float = 0.95,
    minimum_order_quantity: int = 0,
    order_multiple: int = 1,
) -> dict:
    """Return a unit-consistent order suggestion from caller-supplied assumptions.

    Forecast values and stock quantities use the same demand units. If an error
    standard deviation is supplied, safety stock uses a normal, zero-mean,
    independent daily-error approximation. Otherwise the caller must supply an explicit
    fallback safety-stock quantity. Stockout risk is only estimated when an
    error standard deviation is supplied; outstanding-order timing is unknown,
    so that risk estimate uses on-hand less backorders and excludes open orders.
    Omitted outstanding orders and backorders are assumed to be zero and reported
    in the result. Minimum order quantity and order multiple default to 0 and 1.
    """
    if isinstance(lead_time_days, bool) or not isinstance(lead_time_days, int):
        raise ValueError("lead_time_days must be a positive integer.")
    if lead_time_days <= 0:
        raise ValueError("lead_time_days must be a positive integer.")
    if forecast_demand is None:
        raise ValueError("forecast_demand is required.")
    if len(forecast_demand) < lead_time_days:
        raise ValueError("forecast_demand must cover every lead-time day.")

    def finite_nonnegative(name: str, value: float) -> float:
        if isinstance(value, bool):
            raise ValueError(f"{name} must be a finite, non-negative number.")
        try:
            number = float(value)
        except (TypeError, ValueError) as exc:
            raise ValueError(f"{name} must be a finite, non-negative number.") from exc
        if not math.isfinite(number) or number < 0:
            raise ValueError(f"{name} must be a finite, non-negative number.")
        return number

    forecast = [
        finite_nonnegative(f"forecast_demand[{index}]", value)
        for index, value in enumerate(forecast_demand)
    ]
    on_hand_qty = finite_nonnegative("on_hand", on_hand)
    outstanding_qty = finite_nonnegative(
        "outstanding_orders", 0 if outstanding_orders is None else outstanding_orders
    )
    backorder_qty = finite_nonnegative(
        "backorders", 0 if backorders is None else backorders
    )
    target_qty = finite_nonnegative("target_stock_level", target_stock_level)
    if (
        isinstance(minimum_order_quantity, bool)
        or not isinstance(minimum_order_quantity, int)
        or minimum_order_quantity < 0
    ):
        raise ValueError("minimum_order_quantity must be a non-negative integer.")
    if (
        isinstance(order_multiple, bool)
        or not isinstance(order_multiple, int)
        or order_multiple <= 0
    ):
        raise ValueError("order_multiple must be a positive integer.")
    lead_time_demand = sum(forecast[:lead_time_days])

    if (forecast_error_std is None) == (fallback_safety_stock is None):
        raise ValueError(
            "Provide exactly one of forecast_error_std or fallback_safety_stock."
        )
    if forecast_error_std is not None:
        error_std = finite_nonnegative("forecast_error_std", forecast_error_std)
        try:
            service_level_value = float(service_level)
        except (TypeError, ValueError) as exc:
            raise ValueError("service_level must be strictly between 0 and 1.") from exc
        if (
            isinstance(service_level, bool)
            or not math.isfinite(service_level_value)
            or not 0 < service_level_value < 1
        ):
            raise ValueError("service_level must be strictly between 0 and 1.")
        z_score = NormalDist().inv_cdf(service_level_value)
        safety_stock = max(0.0, z_score * error_std * math.sqrt(lead_time_days))
        safety_basis = (
            "Normal approximation using caller-supplied one-day forecast-error standard deviation; "
            "assumes independent, stable daily errors."
        )
        risk_sigma = error_std * math.sqrt(lead_time_days)
        available_during_lead_time = max(0.0, on_hand_qty - backorder_qty)
        if risk_sigma == 0:
            stockout_risk = float(lead_time_demand > available_during_lead_time)
        else:
            stockout_risk = 1.0 - NormalDist(
                mu=lead_time_demand, sigma=risk_sigma
            ).cdf(available_during_lead_time)
            stockout_risk = min(1.0, max(0.0, stockout_risk))
        risk_basis = (
            "Approximate lead-time risk under the normal independent-error assumption; based on on-hand "
            "less backorders and excludes outstanding orders because their arrival dates are unknown."
        )
    else:
        safety_stock = finite_nonnegative("fallback_safety_stock", fallback_safety_stock)
        safety_basis = "Explicit caller-supplied fallback safety-stock quantity."
        stockout_risk = None
        risk_basis = "Not estimated because calibrated forecast-error information was not supplied."

    reorder_point = lead_time_demand + safety_stock
    if target_qty < reorder_point:
        raise ValueError("target_stock_level must be at least the calculated reorder point.")

    inventory_position = on_hand_qty + outstanding_qty - backorder_qty
    should_reorder = inventory_position <= reorder_point
    required_quantity = max(0.0, target_qty - inventory_position) if should_reorder else 0.0
    if required_quantity > 0:
        constrained_quantity = max(required_quantity, float(minimum_order_quantity))
        order_quantity = math.ceil(constrained_quantity / order_multiple) * order_multiple
    else:
        order_quantity = 0
    should_reorder = order_quantity > 0
    position_assumptions = []
    if outstanding_orders is None:
        position_assumptions.append("outstanding_orders omitted; treated as 0")
    if backorders is None:
        position_assumptions.append("backorders omitted; treated as 0")

    return {
        "lead_time_demand": lead_time_demand,
        "safety_stock": safety_stock,
        "safety_stock_basis": safety_basis,
        "reorder_point": reorder_point,
        "inventory_position": inventory_position,
        "target_stock_level": target_qty,
        "suggested_order_quantity": int(order_quantity),
        "projected_inventory_position_after_order": inventory_position + order_quantity,
        "recommendation_status": "REORDER" if should_reorder else "SUFFICIENT",
        "inventory_position_assumptions": position_assumptions,
        "order_constraints": {
            "minimum_order_quantity": minimum_order_quantity,
            "order_multiple": order_multiple,
        },
        "estimated_stockout_risk": stockout_risk,
        "stockout_risk_basis": risk_basis,
        "units": "same units as forecast demand and stock inputs",
    }