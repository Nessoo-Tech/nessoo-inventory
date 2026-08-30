// Auth guard for Nessoo voucher matching platform
// Usage in portal pages:
// <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
// <script src="/js/supabase-client.js"></script>
// <script src="/js/auth-guard.js"></script>
// Then in page script: await initAuth('caseworker');

window.currentUser = null;

/**
 * Initialize auth — checks session, fetches profile, verifies role.
 * @param {string} requiredRole - 'caseworker', 'landlord', or 'admin'
 * @returns {Promise<object>} currentUser object
 */
async function initAuth(requiredRole) {
  const { data: { session } } = await supabase.auth.getSession();

  if (!session) {
    window.location.href = '/login.html';
    return;
  }

  // Fetch user profile
  const { data: profile, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', session.user.id)
    .single();

  if (error || !profile) {
    console.error('Failed to fetch profile:', error);
    await logout();
    return;
  }

  // Role check — admins can access any portal
  if (requiredRole && profile.role !== requiredRole && profile.role !== 'admin') {
    redirectToCorrectPortal(profile.role);
    return;
  }

  // Fetch organization name if applicable
  let orgName = null;
  if (profile.organization_id) {
    const { data: org } = await supabase
      .from('organizations')
      .select('name')
      .eq('id', profile.organization_id)
      .single();
    if (org) orgName = org.name;
  }

  window.currentUser = {
    id: session.user.id,
    email: session.user.email,
    fullName: profile.full_name,
    role: profile.role,
    organizationId: profile.organization_id,
    orgName: orgName
  };

  return window.currentUser;
}

/**
 * Redirect user to the portal matching their role.
 */
function redirectToCorrectPortal(role) {
  const portals = {
    caseworker: '/voucher-caseworker.html',
    landlord: '/voucher-landlord.html',
    admin: '/admin.html'
  };
  window.location.href = portals[role] || '/login.html';
}

/**
 * Check that the current user has the given role.
 * Redirects to login if no session or wrong role.
 */
function requireRole(role) {
  if (!window.currentUser) {
    window.location.href = '/login.html';
    return false;
  }
  if (window.currentUser.role !== role && window.currentUser.role !== 'admin') {
    redirectToCorrectPortal(window.currentUser.role);
    return false;
  }
  return true;
}

/**
 * Sign out and redirect to login page.
 */
async function logout() {
  await supabase.auth.signOut();
  window.currentUser = null;
  window.location.href = '/login.html';
}
