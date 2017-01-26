'use strict';

var webpack = require('webpack');

module.exports = {
  entry: './src/index.js',
  output: {
    filename: './build/cowlick.js',
    libraryTarget: 'var',
    library: 'cowlick'
  },
  externals: {
    React: 'react'
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
  },
  plugins: [
    new webpack.DefinePlugin({
      'process.env': {
        NODE_ENV: JSON.stringify('production')
      }
    }),
    new webpack.optimize.UglifyJsPlugin()
  ]
};
