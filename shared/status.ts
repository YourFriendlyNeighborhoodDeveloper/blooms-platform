/** Customer-facing wording for every order and item status. Used by the tracking page. */
export const ORDER_STATUS_COPY: Record<string, { title: string; body: string }> = {
  order_placed: { title: 'Order placed', body: 'We have your order.' },
  payment_confirmed: { title: 'Payment confirmed', body: 'Your payment went through.' },
  awaiting_payment: { title: 'Waiting for payment', body: 'Your order is held for you. It is confirmed once payment is received.' },
  payment_processing: { title: 'Payment processing', body: 'Your bank is confirming the payment. Your order moves forward once it does.' },
  payment_failed: { title: 'Payment did not go through', body: 'You have not been charged. You can try again below.' },
  awaiting_review: { title: 'With the shop for review', body: 'Someone from the shop will confirm this and let you know.' },
  needs_customer: { title: 'We have a question', body: 'The shop needs a little more information from you. Please check your email.' },
  accepted: { title: 'Accepted', body: 'The shop has accepted your order and it is on the schedule.' },
  preparing: { title: 'Being prepared', body: 'Work on your order has started.' },
  ready: { title: 'Ready', body: 'Your order is ready.' },
  out_for_delivery: { title: 'Out for delivery', body: 'Your order has left the shop.' },
  shipped: { title: 'Shipped', body: 'Your order is on its way.' },
  partially_fulfilled: { title: 'Partly complete', body: 'Some items are done. The rest are still in progress.' },
  fulfilled: { title: 'Fulfilled', body: 'Everything on your order has been delivered or collected.' },
  completed: { title: 'Complete', body: 'Thank you for your order.' },
  rescheduling: { title: 'Being rescheduled', body: 'The shop is arranging a new time with you.' },
  delivery_failed: { title: 'Delivery problem', body: 'We could not complete a delivery. The shop will contact you.' },
  inventory_shortage: { title: 'Delayed', body: 'Something on your order is short. The shop will contact you about it.' },
  rejected: { title: 'Declined', body: 'The shop could not take this order.' },
  cancelled: { title: 'Cancelled', body: 'This order was cancelled.' },
  expired: { title: 'Expired', body: 'This order was not completed in time, so nothing was charged.' },
  returned: { title: 'Returned', body: 'This order was returned.' },
};

export const ITEM_STATUS_COPY: Record<string, string> = {
  pending: 'Scheduled',
  preparing: 'Being prepared',
  ready: 'Ready',
  out_for_delivery: 'Out for delivery',
  shipped: 'Shipped',
  fulfilled: 'Done',
  backordered: 'On backorder',
  shortage: 'Delayed',
  delivery_failed: 'Delivery problem',
  cancelled: 'Cancelled',
  refunded: 'Refunded',
  returned: 'Returned',
};

export const ACTIVE_STEPS = ['accepted', 'preparing', 'ready', 'fulfilled'] as const;
