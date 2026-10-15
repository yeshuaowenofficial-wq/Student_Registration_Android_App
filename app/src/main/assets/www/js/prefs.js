/**
 * Campus Companion — personalisation & accessibility preferences
 * Themes (60-30-10 palettes), colour-vision modes, text size, and app logo.
 * Saved in localStorage and applied as data-* attributes on <html>.
 */
(function () {
  'use strict';

  const LS_KEY = 'cc.prefs';

  const THEMES = [
    { id: 'classic', name: 'Mulungushi Purple', swatch: ['#F8F7FC', '#50207A', '#838CE5'] },
    { id: 'navy-sky', name: 'Navy & Sky Blue', swatch: ['#F4F8FC', '#1B2A4A', '#4FA3D9'] },
    { id: 'navy-beige', name: 'Navy & Beige', swatch: ['#F5F0E6', '#1B2A4A', '#5BAEDC'] },
    { id: 'sky-white', name: 'Sky Blue & White', swatch: ['#FFFFFF', '#1F6FA8', '#1B2A4A'] },
    { id: 'midnight', name: 'Midnight Navy (Dark)', swatch: ['#0F1A2E', '#87CEEB', '#F5DEB3'] }
  ];

  const CVD_MODES = [
    { id: 'none', name: 'Standard colours', desc: 'Default palette' },
    { id: 'protanopia', name: 'Protanopia', desc: 'Red-blind: success/error become blue/orange' },
    { id: 'deuteranopia', name: 'Deuteranopia', desc: 'Green-blind: blue/orange safe palette' },
    { id: 'tritanopia', name: 'Tritanopia', desc: 'Blue-yellow: red/teal safe palette' },
    { id: 'achromatopsia', name: 'Monochrome', desc: 'Full greyscale with stronger contrast' },
    { id: 'high-contrast', name: 'High contrast', desc: 'Darker text and borders' }
  ];

  // App logos. "launcher" is the Android activity-alias suffix used to swap the home-screen icon.
  const LOGOS = [
    { id: 'mu', name: 'Mulungushi Crest', src: 'icons/mu_logo.png', launcher: 'LauncherMU' },
    { id: 'cap', name: 'Navy Graduation Cap', src: 'icons/logo-cap.svg', launcher: 'LauncherCap' },
    { id: 'book', name: 'Sky Open Book', src: 'icons/logo-book.svg', launcher: 'LauncherBook' }
  ];

  const DEFAULTS = { theme: 'classic', cvd: 'none', largeText: false, logo: 'mu' };

  function load() {
    try { return Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem(LS_KEY) || '{}')); }
    catch (_) { return Object.assign({}, DEFAULTS); }
  }

  const Prefs = {
    THEMES, CVD_MODES, LOGOS,
    values: load(),

    apply() {
      const root = document.documentElement;
      root.dataset.theme = this.values.theme;
      root.dataset.cvd = this.values.cvd;
      root.dataset.largeText = this.values.largeText ? 'on' : 'off';
      const meta = document.querySelector('meta[name="theme-color"]');
      const t = THEMES.find(x => x.id === this.values.theme) || THEMES[0];
      if (meta) meta.setAttribute('content', t.swatch[1]);
    },

    set(key, value) {
      this.values[key] = value;
      localStorage.setItem(LS_KEY, JSON.stringify(this.values));
      this.apply();
      if (key === 'logo') this.applyLauncherIcon();
    },

    logo() { return LOGOS.find(l => l.id === this.values.logo) || LOGOS[0]; },

    /** Asks Android to swap the home-screen icon (activity-alias). No-op in a browser. */
    applyLauncherIcon() {
      if (window.Android && window.Android.setLauncherIcon) {
        try { window.Android.setLauncherIcon(this.logo().launcher); } catch (_) { /* ignore */ }
      }
    },

    avatarUrl(key) { return key ? `pfps/${key}.svg` : null; }
  };

  Prefs.apply();
  window.CCPrefs = Prefs;
})();
