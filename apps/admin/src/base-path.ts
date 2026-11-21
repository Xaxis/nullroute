/**
 * Where the console lives: nullroute.diy/admin. The site's deploy passes every request under
 * /admin through to this project (ADMIN_PATH in tools/lib/site-headers.mjs, the same value).
 *
 * next/link, next/navigation's redirect, the proxy's redirects and the config's headers add it on
 * their own. A raw fetch, a form's action, a route handler's Location and a link in an email do
 * not, and those use this.
 */
export const BASE_PATH = '/admin'
