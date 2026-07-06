/**
 * ============================================================
 *  G-CARS 2 — Authentication Middleware
 * ============================================================
 *  Exports Express middleware functions used to guard routes
 *  by verifying JWT tokens and checking user roles/types.
 *
 *  Exported functions:
 *    authMiddleware   – Verifies the Bearer token on every request
 *    superAdminOnly   – Allows superadmin role only
 *    adminOrSuperAdmin – Allows admin OR superadmin roles
 *    cfoOrAdmin       – Allows CFO, admin, superadmin, or budget_owner
 * ============================================================
 */

const jwt = require('jsonwebtoken');

/**
 * authMiddleware
 * ──────────────────────────────────────────────────────────────
 * Validates the JWT Bearer token from the Authorization header.
 * On success, attaches the decoded payload to `req.user` and
 * calls next(). On failure, responds with 401.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
const authMiddleware = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  if (!authHeader) {
    return res.status(401).json({ success: false, message: 'No token provided' });
  }

  // Strip the 'Bearer ' prefix if present
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded; // payload: { id, emp_no, email, username, user_type, roles, permissions }
    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: 'Invalid or expired token' });
  }
};

/**
 * superAdminOnly
 * ──────────────────────────────────────────────────────────────
 * Restricts the route to users whose `user_type` is 'superadmin'
 * OR who have the 'superadmin' role assigned.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
const superAdminOnly = (req, res, next) => {
  const isSA =
    req.user?.user_type === 'superadmin' ||
    req.user?.roles?.includes('superadmin');

  if (!isSA) {
    return res.status(403).json({ success: false, message: 'Super admin access required' });
  }
  next();
};

/**
 * adminOrSuperAdmin
 * ──────────────────────────────────────────────────────────────
 * Restricts the route to users with 'admin' or 'superadmin'
 * in either `user_type` or `roles`.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
const adminOrSuperAdmin = (req, res, next) => {
  const ADMIN_TYPES = ['admin', 'superadmin'];
  const isAdmin =
    ADMIN_TYPES.includes(req.user?.user_type) ||
    req.user?.roles?.some(r => ADMIN_TYPES.includes(r));

  if (!isAdmin) {
    return res.status(403).json({ success: false, message: 'Admin access required' });
  }
  next();
};

/**
 * cfoOrAdmin
 * ──────────────────────────────────────────────────────────────
 * Allows access for CFO, admin, superadmin, or budget_owner users.
 * Used on financial routes (allocations, budgets) where multiple
 * elevated roles need read/write access.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
const cfoOrAdmin = (req, res, next) => {
  const ADMIN_TYPES  = ['admin', 'superadmin'];
  const isCFO        = req.user?.roles?.includes('cfo');
  const isAdmin      = ADMIN_TYPES.includes(req.user?.user_type) ||
                       req.user?.roles?.some(r => ADMIN_TYPES.includes(r));
  const isBudgetOwner = req.user?.user_type === 'budget_owner' ||
                        req.user?.roles?.includes('budget_owner');

  if (!isCFO && !isAdmin && !isBudgetOwner) {
    return res.status(403).json({ success: false, message: 'Unauthorized: Financial access required' });
  }
  next();
};

module.exports = { authMiddleware, superAdminOnly, adminOrSuperAdmin, cfoOrAdmin };
