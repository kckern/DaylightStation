/** Find capability-compatible identifiers for the same content artifact. */
export class ContentAlternatesService {
  constructor({ contentCatalog }) {
    if (!contentCatalog?.findAlternates) throw new Error('ContentAlternatesService requires contentCatalog');
    this.contentCatalog = contentCatalog;
  }

  findAlternates(contentId) {
    return this.contentCatalog.findAlternates(contentId);
  }
}

export default ContentAlternatesService;
