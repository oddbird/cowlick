'use strict';

module.exports = {
  entry: './src/index.js',
  output: {
    filename: './build/cowlick.js',
    libraryTarget: 'var',
    library: 'cowlick'
  },
  node: {
    fs: 'empty'
  },
  module: {
    loaders: [
      {
        test: /src.*\.js$/,
        loader: 'transform/cacheable?brfs'
      }
    ]
  }
};
