const { defineConfig, externalizeDepsPlugin } = require('electron-vite');
const react = require('@vitejs/plugin-react');

module.exports = defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
  },
  renderer: {
    root: 'src/renderer',
    plugins: [react()],
  },
});
