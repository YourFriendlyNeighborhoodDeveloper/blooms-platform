# Delivery, pickup and capacity

The shop only offers times it can actually meet. When a customer chooses delivery or pickup, the
system checks every rule below, and checks again at the moment they pay. If something has changed,
it refuses politely and suggests the earliest time that works.

## Delivery areas

Under **Deliveries → Delivery zones**, each zone lists its ZIP codes, a delivery fee, an optional
minimum order, and the travel time added to preparation. A customer outside every zone is told so,
and offered pickup instead.

## Times

Under **Deliveries → Pickup and delivery windows**, set the times offered for each day, for example
deliveries from 10 to 1 and from 2 to 5. For each window:

- **Cutoff:** orders stop this many minutes before the window starts.
- **Most orders in this window:** once full, the window is no longer offered. Blank means the shop confirms each order by hand.

## Daily capacity

Under **Settings → Ordering**:

- **Most orders in a day,** and **most workload points in a day.** Each product carries points, so one large arrangement counts for more than a small bouquet.
- **Minimum notice** for every order. Products can ask for more, such as three days for custom work.
- **Same-day orders,** on or off, with a cutoff time. After the cutoff, today is no longer offered.

## Drivers and vehicles

- Delivery is only offered on days a driver is scheduled, unless you turn that rule off.
- When a driver is away, delivery stops being offered that day.
- Assign each delivery to a driver and vehicle, and group them into runs. The order of stops is yours to choose.
- Drivers record each step: out for delivery, delivered (with an optional note as proof), or failed with a reason. The customer sees each step. There is no live GPS tracking, and the site never claims there is.

## Closures and busy days

Under **Settings → Hours & closures**:

- **Closures** stop orders, deliveries, pickups, consultations or events for chosen dates, for the whole business or one department, with a message customers see.
- **Capacity for specific dates** sets different limits for one day, such as more orders before Valentine's Day, or fewer when someone is out.

## Shipping

Off by default. When on: a flat charge, an optional free-shipping threshold, and the states you ship
to. Staff enter the carrier and tracking number when an order ships, and the customer sees them.
There is no automatic carrier tracking.

## What the demonstration shows

- A Saturday morning delivery window that is already full, while the afternoon is still open.
- A day the only driver is away, so delivery is not offered.
- A sold-out product that cannot be added to the cart.
- A custom design that needs three days' notice.
- Today, after the same-day cutoff, is not offered.
