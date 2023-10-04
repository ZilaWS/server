const path = require('path');
const TerserPlugin = require('terser-webpack-plugin');
const { getPackageName } = require('./getPackageName');

/**
 * @type {import("webpack").Configuration}
 */
module.exports = {
  mode: 'production',
  entry: './src/index.ts',
  output: {
    path: path.resolve(__dirname, '../dist/umd'),
    filename: 'index.js',
    library: getPackageName(),
    libraryTarget: 'umd',
    globalObject: 'this',
  },
  module: {
    rules: [
      {
        test: /\.ts(x*)?$/,
        exclude: /node_modules/,
        use: {
          loader: 'ts-loader',
          options: {
            configFile: 'config/tsconfig.umd.json',
          },
        },
      },
    ],
  },
  optimization:{
    minimize: true,
    minimizer: [
      new TerserPlugin()
    ]
  },
  resolve: {
    extensions: ['.ts', '.js', '.tsx', '.jsx'],
  }
}
