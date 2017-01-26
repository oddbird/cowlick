'use strict';

module.exports = {
  entry: './src/index.js',
  output: {
    filename: './build/cowlick.js'
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
