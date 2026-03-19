module.exports = {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx,html}',
    './src/js/**/*.{js,ts}'
  ],
  theme: {
    extend: {},
  },
  plugins: [require('daisyui')],
};
