const jwt = require('jsonwebtoken');

const authMiddleware = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  if (!authHeader) return res.status(401).json({ success: false, message: 'No token provided' });

  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: 'Invalid or expired token' });
  }
};

const superAdminOnly = (req, res, next) => {
  const isSA = req.user?.user_type === 'superadmin' || req.user?.roles?.includes('superadmin');
  if (!isSA) {
    return res.status(403).json({ success: false, message: 'Super admin access required' });
  }
  next();
};


const adminOrSuperAdmin = (req, res, next) => {
  const isAdmin = ['admin', 'superadmin'].includes(req.user?.user_type) || req.user?.roles?.some(r => ['admin', 'superadmin'].includes(r));
  if (!isAdmin) {
    return res.status(403).json({ success: false, message: 'Admin access required' });
  }
  next();
};

const cfoOrAdmin = (req, res, next) => {
  const isCFO = req.user?.roles?.includes('cfo');
  const isAdmin = ['admin', 'superadmin'].includes(req.user?.user_type) || req.user?.roles?.some(r => ['admin', 'superadmin'].includes(r));
  const isBudgetOwner = req.user?.user_type === 'budget_owner' || req.user?.roles?.includes('budget_owner');
  if (!isCFO && !isAdmin && !isBudgetOwner) {
    return res.status(403).json({ success: false, message: 'Unauthorized: Financial access required' });
  }
  next();
};

module.exports = { authMiddleware, superAdminOnly, adminOrSuperAdmin, cfoOrAdmin };
