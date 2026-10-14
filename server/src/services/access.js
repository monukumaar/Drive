const { File, Folder } = require('../models');
const { notFound, forbidden, conflict } = require('../utils/errors');

const RANK = { viewer: 1, editor: 2, owner: 3 };
const NAME_OF = { 1: 'viewer', 2: 'editor', 3: 'owner' };

const modelFor = (kind) => (kind === 'folder' ? Folder : File);

/**
 * Effective role of `userId` on an item: owner, or the strongest share found on
 * the item itself or any ancestor folder (sharing a folder shares its subtree).
 * Returns null when the user has no access at all.
 */
async function roleFor(userId, item, kind) {
  const uid = String(userId);
  if (String(item.owner) === uid) return 'owner';

  let best = 0;
  const consider = (shares) => {
    for (const s of shares || []) if (String(s.user) === uid) best = Math.max(best, RANK[s.role]);
  };
  consider(item.shares);

  let ancestorIds = [];
  if (kind === 'folder') {
    ancestorIds = item.ancestors || [];
  } else if (item.parent) {
    const parent = await Folder.findById(item.parent).select('ancestors shares');
    if (parent) {
      consider(parent.shares);
      ancestorIds = parent.ancestors;
    }
  }
  if (ancestorIds.length) {
    const folders = await Folder.find({ _id: { $in: ancestorIds }, 'shares.user': userId }).select('shares');
    folders.forEach((f) => consider(f.shares));
  }
  return best ? NAME_OF[best] : null;
}

/**
 * Load an item and enforce a minimum role.
 * - Missing, trashed (unless allowed) or inaccessible items are all reported as 404 so that
 *   IDs cannot be probed for existence.
 * - 403 is only returned when the user *can* see the item but lacks the needed role.
 */
async function loadItem(kind, id, user, minRole = 'viewer', { allowTrashed = false } = {}) {
  const item = await modelFor(kind).findById(id);
  if (!item || (item.trashed && !allowTrashed)) throw notFound(`${kind === 'folder' ? 'Folder' : 'File'} not found`);
  const role = await roleFor(user._id, item, kind);
  if (!role) throw notFound(`${kind === 'folder' ? 'Folder' : 'File'} not found`);
  if (RANK[role] < RANK[minRole]) throw forbidden(`Requires ${minRole} access`);
  return { item, role };
}

/** Duplicate-name check across files and folders in one parent (exact, case-sensitive match). */
async function assertNameFree(ownerId, parentId, name, excludeId = null) {
  const q = { owner: ownerId, parent: parentId || null, name, trashed: false };
  if (excludeId) q._id = { $ne: excludeId };
  const [f, d] = await Promise.all([File.exists(q), Folder.exists(q)]);
  if (f || d) throw conflict(`An item named "${name}" already exists in this folder`, 'DUPLICATE_NAME');
}

/** Find a free name by adding a suffix; used when restoring from trash. */
async function freeName(ownerId, parentId, name) {
  const q = (n) => ({ owner: ownerId, parent: parentId || null, name: n, trashed: false });
  for (let i = 0; i < 100; i += 1) {
    const candidate = i === 0 ? name : `${name} (restored${i > 1 ? ` ${i}` : ''})`;
    // eslint-disable-next-line no-await-in-loop
    const [f, d] = await Promise.all([File.exists(q(candidate)), Folder.exists(q(candidate))]);
    if (!f && !d) return candidate;
  }
  throw conflict('Could not find a free name', 'DUPLICATE_NAME');
}

/**
 * Breadcrumb trail. Non-owners only see ancestors from the point where the folder
 * was shared with them downwards, so names above it are not leaked.
 */
async function breadcrumbs(folder, user, role) {
  const docs = await Folder.find({ _id: { $in: folder.ancestors } }).select('name shares');
  const byId = new Map(docs.map((d) => [String(d._id), d]));
  let chain = folder.ancestors.map((id) => byId.get(String(id))).filter(Boolean);
  if (role !== 'owner') {
    const uid = String(user._id);
    const start = chain.findIndex((f) => f.shares.some((s) => String(s.user) === uid));
    chain = start === -1 ? [] : chain.slice(start);
  }
  return [...chain, folder].map((f) => ({ id: f._id, name: f.name }));
}

const folderDTO = (f, role) => ({
  kind: 'folder',
  id: f._id,
  name: f.name,
  parentId: f.parent,
  ownerId: f.owner,
  createdAt: f.createdAt,
  updatedAt: f.updatedAt,
  ...(f.trashed ? { trashedAt: f.trashedAt } : {}),
  ...(role ? { role } : {}),
});

const fileDTO = (f, role) => ({
  kind: 'file',
  id: f._id,
  name: f.name,
  parentId: f.parent,
  ownerId: f.owner,
  size: f.size,
  mimeType: f.mimeType,
  currentVersion: f.currentVersion,
  createdAt: f.createdAt,
  updatedAt: f.updatedAt,
  ...(f.trashed ? { trashedAt: f.trashedAt } : {}),
  ...(role ? { role } : {}),
});

module.exports = { RANK, roleFor, loadItem, assertNameFree, freeName, breadcrumbs, folderDTO, fileDTO, modelFor };
