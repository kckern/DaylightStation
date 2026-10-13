import express from 'express';

export function createBuildMetadataRouter({ source } = {}) {
  if (!source?.read) throw new Error('createBuildMetadataRouter requires source');
  const router = express.Router();
  router.get('/build.txt', (req, res) => {
    const metadata = source.read();
    res.type('text/plain');
    return metadata.kind === 'file' ? res.sendFile(metadata.path) : res.send(metadata.value);
  });
  return router;
}
