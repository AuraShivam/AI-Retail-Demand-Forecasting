import pytest

from backend.app.services.inventory_decision import recommend_replenishment


def test_low_inventory_recommends_order_to_target():
    result = recommend_replenishment(
        [10, 12, 8], 2, 5, 30, fallback_safety_stock=3
    )

    assert result["lead_time_demand"] == 22
    assert result["reorder_point"] == 25
    assert result["inventory_position"] == 5
    assert result["suggested_order_quantity"] == 25
    assert result["recommendation_status"] == "REORDER"
    assert result["estimated_stockout_risk"] is None


def test_sufficient_inventory_does_not_recommend_order():
    result = recommend_replenishment(
        [4, 5, 6], 2, 40, 50, fallback_safety_stock=2
    )

    assert result["recommendation_status"] == "SUFFICIENT"
    assert result["suggested_order_quantity"] == 0


def test_zero_demand_and_zero_stock_have_zero_recommendation_at_zero_target():
    result = recommend_replenishment(
        [0, 0], 2, 0, 0, fallback_safety_stock=0
    )

    assert result["lead_time_demand"] == 0
    assert result["reorder_point"] == 0
    assert result["recommendation_status"] == "SUFFICIENT"
    assert result["suggested_order_quantity"] == 0


def test_at_reorder_point_triggers_order_and_accounts_for_pipeline():
    result = recommend_replenishment(
        [5, 5], 2, 8, 25, outstanding_orders=4, backorders=2,
        fallback_safety_stock=0,
    )

    assert result["inventory_position"] == 10
    assert result["reorder_point"] == 10
    assert result["recommendation_status"] == "REORDER"
    assert result["suggested_order_quantity"] == 15


def test_order_minimum_and_multiple_are_applied_and_reported():
    result = recommend_replenishment(
        [5, 5], 2, 4, 20, fallback_safety_stock=0,
        minimum_order_quantity=12, order_multiple=6,
    )

    assert result["suggested_order_quantity"] == 18
    assert result["projected_inventory_position_after_order"] == 22
    assert result["order_constraints"] == {
        "minimum_order_quantity": 12,
        "order_multiple": 6,
    }


def test_omitted_pipeline_quantities_are_explicitly_assumed_zero():
    result = recommend_replenishment(
        [2], 1, 1, 5, fallback_safety_stock=0
    )

    assert result["inventory_position"] == 1
    assert result["inventory_position_assumptions"] == [
        "outstanding_orders omitted; treated as 0",
        "backorders omitted; treated as 0",
    ]


def test_error_std_drives_safety_stock_and_qualified_risk():
    result = recommend_replenishment(
        [10, 10], 2, 5, 40, forecast_error_std=2, service_level=0.95
    )

    assert result["safety_stock"] > 0
    assert 0 <= result["estimated_stockout_risk"] <= 1
    assert "excludes outstanding orders" in result["stockout_risk_basis"]


@pytest.mark.parametrize(
    "kwargs",
    [
        {"forecast_demand": [1], "lead_time_days": 2, "on_hand": 1, "target_stock_level": 3, "fallback_safety_stock": 0},
        {"forecast_demand": [-1], "lead_time_days": 1, "on_hand": 1, "target_stock_level": 3, "fallback_safety_stock": 0},
        {"forecast_demand": [1], "lead_time_days": 1, "on_hand": -1, "target_stock_level": 3, "fallback_safety_stock": 0},
        {"forecast_demand": [1], "lead_time_days": 1, "on_hand": 1, "target_stock_level": 0, "fallback_safety_stock": 0},
        {"forecast_demand": [1], "lead_time_days": 1, "on_hand": 1, "target_stock_level": 3},
        {"forecast_demand": [1], "lead_time_days": 1, "on_hand": 1, "target_stock_level": 3, "fallback_safety_stock": 0, "order_multiple": 0},
        {"forecast_demand": [1], "lead_time_days": 1, "on_hand": 1, "target_stock_level": 3, "forecast_error_std": 1, "service_level": 1.0},
        {"forecast_demand": None, "lead_time_days": 1, "on_hand": 1, "target_stock_level": 3, "fallback_safety_stock": 0},
    ],
)
def test_invalid_or_underspecified_inputs_raise(kwargs):
    with pytest.raises(ValueError):
        recommend_replenishment(**kwargs)