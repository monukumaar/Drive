const { z } = require('zod');

const pageQuery = {
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
};

const COLLATION = { locale: 'en', strength: 2 };
const SORT = { name: 1, _id: 1 };

/**
 * Paginate "folders first, then files" across two collections with a single
 * page/limit pair, so the client sees one ordered list.
 */
async function paginateFoldersAndFiles(Folder, File, folderFilter, fileFilter, { page, limit }) {
  const [folderCount, fileCount] = await Promise.all([
    Folder.countDocuments(folderFilter),
    File.countDocuments(fileFilter),
  ]);
  const skip = (page - 1) * limit;
  let folders = [];
  let files = [];
  if (skip < folderCount) {
    folders = await Folder.find(folderFilter).sort(SORT).collation(COLLATION).skip(skip).limit(limit);
  }
  const remaining = limit - folders.length;
  if (remaining > 0) {
    const fileSkip = Math.max(0, skip - folderCount);
    files = await File.find(fileFilter).sort(SORT).collation(COLLATION).skip(fileSkip).limit(remaining);
  }
  const total = folderCount + fileCount;
  return {
    folders,
    files,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit), folderCount, fileCount },
  };
}

module.exports = { pageQuery, paginateFoldersAndFiles };
