const roleGuard = (allowedRoles) => {
  const normalizedRoles = Array.isArray(allowedRoles)
    ? allowedRoles
    : [allowedRoles];

  return (req, res, next) => {
    if (!req.user || !normalizedRoles.includes(req.user.roleType)) {
      return res.status(403).json({ success: false, error: "Forbidden" });
    }

    return next();
  };
};

module.exports = roleGuard;
