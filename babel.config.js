module.exports = {
  presets: [
    ['@babel/preset-env', {
      targets: { node: 'current' }
    }]
  ],
  plugins: [
    // Handle import.meta.url in ESM files
    function () {
      return {
        visitor: {
          MetaProperty(path) {
            // Replace import.meta.url with a CommonJS equivalent
            if (
              path.node.meta.name === 'import' &&
              path.node.property.name === 'meta'
            ) {
              // Check if it's import.meta.url
              const parent = path.parentPath;
              if (
                parent.isMemberExpression() &&
                parent.node.property.name === 'url'
              ) {
                // Replace import.meta.url with require('url').pathToFileURL(__filename).href
                parent.replaceWithSourceString(
                  "require('url').pathToFileURL(__filename).href"
                );
              }
            }
          }
        }
      };
    }
  ]
};
