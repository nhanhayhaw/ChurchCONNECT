/**
 * Global search - powers the header search box.
 *
 * Returns a small mixed result set across members, departments and groups so
 * one keystroke stream can find anything. Members dominate the results because
 * that is what administrators look for 95% of the time.
 */
import { Router } from 'express';
import { z } from 'zod';
import { query } from '../../config/db.js';
import { asyncHandler } from '../../utils/http.js';
import { validateQuery } from '../../middleware/validate.js';
import { authenticate } from '../../middleware/auth.js';
import { requirePermission, departmentScope } from '../../middleware/rbac.js';
import { searchMembers } from '../members/members.service.js';

const router = Router();
router.use(authenticate);

router.get(
  '/',
  requirePermission('members:read'),
  validateQuery(z.object({ q: z.string().trim().min(1, 'Type something to search for.').max(120) })),
  asyncHandler(async (req, res) => {
    const term = (req.query as any).q as string;
    const scope = departmentScope(req, 'm.department_id');
    const scopeId = scope ? scope.value : null;

    const [members, departments, groups] = await Promise.all([
      searchMembers(term, 8, scopeId),
      query<any>(
        `SELECT id, name, 'department' AS kind FROM departments
          WHERE is_active AND LOWER(name) LIKE $1 ORDER BY name LIMIT 4`,
        [`%${term.toLowerCase()}%`],
      ),
      query<any>(
        `SELECT id, name, group_type, 'group' AS kind FROM groups
          WHERE is_active AND LOWER(name) LIKE $1 ORDER BY name LIMIT 4`,
        [`%${term.toLowerCase()}%`],
      ),
    ]);

    res.json({
      query: term,
      members,
      departments: departments.rows.map((r) => ({ id: r.id, name: r.name })),
      groups: groups.rows.map((r) => ({ id: r.id, name: r.name, groupType: r.group_type })),
      total: members.length + departments.rows.length + groups.rows.length,
    });
  }),
);

export default router;
