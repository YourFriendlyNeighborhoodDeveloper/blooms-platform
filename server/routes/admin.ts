import { Hono } from 'hono';
import type { AppEnv } from '../http/types.js';
import { adminCatalogRoutes } from './admin-catalog.js';
import { adminInventoryRoutes } from './admin-inventory.js';
import { adminOpsRoutes } from './admin-ops.js';
import { adminCustomerRoutes, adminMessageRoutes } from './admin-crm.js';
import { adminSystemRoutes } from './admin-system.js';
import { adminConciergeRoutes } from './admin-concierge.js';
import { adminInvoiceRoutes, adminPaymentRoutes, adminWeddingRoutes } from './admin-weddings.js';

export const adminRoutes = new Hono<AppEnv>();

adminRoutes.route('/weddings', adminWeddingRoutes);
adminRoutes.route('/invoices', adminInvoiceRoutes);
adminRoutes.route('/payments', adminPaymentRoutes);
adminRoutes.route('/catalog', adminCatalogRoutes);
adminRoutes.route('/inventory', adminInventoryRoutes);
adminRoutes.route('/customers', adminCustomerRoutes);
adminRoutes.route('/messages', adminMessageRoutes);
adminRoutes.route('/concierge', adminConciergeRoutes);
adminRoutes.route('/', adminOpsRoutes);
adminRoutes.route('/', adminSystemRoutes);
