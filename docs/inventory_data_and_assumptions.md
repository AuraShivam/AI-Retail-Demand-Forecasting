# Inventory Data and Decision Assumptions

## Observed dataset fields

The raw and cleaned retail records contain `Date`, `Store ID`, `Product ID`,
`Demand`, `Units Sold`, `Units Ordered`, and `Inventory Level`, along with
product/category, region, price, promotion, weather, seasonality, and epidemic
fields. `Inventory Level` is a historical per-record value; it is not a live
on-hand balance. `Units Ordered` is a historical record, not an open purchase
order or evidence of an arrival date.

The dataset does not provide lead time, outstanding-order quantities and
arrival dates, backorders, supplier minimum order quantity, order multiples,
capacity limits, holding costs, shortage costs, or a documented service-level
policy. The available data therefore does not support a faithful historical
replenishment simulation or calculated stockout/service-level/cost claims.

## Inventory decision input contract

`backend/app/services/inventory_decision.py` is a standalone calculation. Its
caller must provide forecast demand for each lead-time day, lead time in days,
current on-hand quantity, target stock level, and either a one-day forecast
error standard deviation or an explicit fallback safety-stock quantity.
Outstanding orders and backorders are optional quantities defaulting to zero;
omission is reported as a zero assumption, so callers should provide current
operational values when known. Minimum order quantity and order multiple are
configurable; defaults are zero minimum and one-unit increments, not constraints
inferred from the dataset.

All demand and quantity inputs must use the same unit. The target stock level
must be at least the resulting reorder point. The error-based safety-stock
formula assumes unbiased, independent, stable daily forecast errors; its normal
approximation is not a calibrated service guarantee. Stockout risk is omitted
when only fallback safety stock is used. If error-based risk is returned, it
uses on-hand less backorders and excludes outstanding orders because their
arrival timing is unavailable to this calculation.

Lead time, target stock, service level, forecast-error standard deviation,
current on-hand, outstanding orders, and backorders are operational inputs or
policy assumptions. None is inferred from the historical `Inventory Level` or
`Units Ordered` fields.