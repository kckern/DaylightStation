/** Aggregates query aliases and discoverable categories for the API surface. */
export class ContentAliasCatalogService {
  constructor({ aliases, discovery }) { this.aliases = aliases; this.discovery = discovery; }
  get available() { return Boolean(this.aliases); }
  catalog() {
    const builtInAliases = this.aliases.getBuiltInAliases();
    const builtIn = Object.keys(builtInAliases);
    return {
      builtIn,
      userDefined: this.aliases.getAvailableAliases().filter((alias) => !builtIn.includes(alias)),
      categories: this.discovery.getCategories(),
    };
  }
}

export default ContentAliasCatalogService;
