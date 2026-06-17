#!/usr/bin/env node
import { createRequire } from "node:module";
var __create = Object.create;
var __getProtoOf = Object.getPrototypeOf;
var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
function __accessProp(key) {
  return this[key];
}
var __toESMCache_node;
var __toESMCache_esm;
var __toESM = (mod, isNodeMode, target) => {
  var canCache = mod != null && typeof mod === "object";
  if (canCache) {
    var cache = isNodeMode ? __toESMCache_node ??= new WeakMap : __toESMCache_esm ??= new WeakMap;
    var cached = cache.get(mod);
    if (cached)
      return cached;
  }
  target = mod != null ? __create(__getProtoOf(mod)) : {};
  const to = isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target;
  for (let key of __getOwnPropNames(mod))
    if (!__hasOwnProp.call(to, key))
      __defProp(to, key, {
        get: __accessProp.bind(mod, key),
        enumerable: true
      });
  if (canCache)
    cache.set(mod, to);
  return to;
};
var __commonJS = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports);
var __returnValue = (v) => v;
function __exportSetter(name, newValue) {
  this[name] = __returnValue.bind(null, newValue);
}
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, {
      get: all[name],
      enumerable: true,
      configurable: true,
      set: __exportSetter.bind(all, name)
    });
};
var __esm = (fn, res) => () => (fn && (res = fn(fn = 0)), res);
var __require = /* @__PURE__ */ createRequire(import.meta.url);

// node_modules/ms/index.js
var require_ms = __commonJS((exports, module) => {
  var s = 1000;
  var m = s * 60;
  var h = m * 60;
  var d = h * 24;
  var w = d * 7;
  var y = d * 365.25;
  module.exports = function(val, options) {
    options = options || {};
    var type = typeof val;
    if (type === "string" && val.length > 0) {
      return parse(val);
    } else if (type === "number" && isFinite(val)) {
      return options.long ? fmtLong(val) : fmtShort(val);
    }
    throw new Error("val is not a non-empty string or a valid number. val=" + JSON.stringify(val));
  };
  function parse(str) {
    str = String(str);
    if (str.length > 100) {
      return;
    }
    var match = /^(-?(?:\d+)?\.?\d+) *(milliseconds?|msecs?|ms|seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d|weeks?|w|years?|yrs?|y)?$/i.exec(str);
    if (!match) {
      return;
    }
    var n = parseFloat(match[1]);
    var type = (match[2] || "ms").toLowerCase();
    switch (type) {
      case "years":
      case "year":
      case "yrs":
      case "yr":
      case "y":
        return n * y;
      case "weeks":
      case "week":
      case "w":
        return n * w;
      case "days":
      case "day":
      case "d":
        return n * d;
      case "hours":
      case "hour":
      case "hrs":
      case "hr":
      case "h":
        return n * h;
      case "minutes":
      case "minute":
      case "mins":
      case "min":
      case "m":
        return n * m;
      case "seconds":
      case "second":
      case "secs":
      case "sec":
      case "s":
        return n * s;
      case "milliseconds":
      case "millisecond":
      case "msecs":
      case "msec":
      case "ms":
        return n;
      default:
        return;
    }
  }
  function fmtShort(ms) {
    var msAbs = Math.abs(ms);
    if (msAbs >= d) {
      return Math.round(ms / d) + "d";
    }
    if (msAbs >= h) {
      return Math.round(ms / h) + "h";
    }
    if (msAbs >= m) {
      return Math.round(ms / m) + "m";
    }
    if (msAbs >= s) {
      return Math.round(ms / s) + "s";
    }
    return ms + "ms";
  }
  function fmtLong(ms) {
    var msAbs = Math.abs(ms);
    if (msAbs >= d) {
      return plural(ms, msAbs, d, "day");
    }
    if (msAbs >= h) {
      return plural(ms, msAbs, h, "hour");
    }
    if (msAbs >= m) {
      return plural(ms, msAbs, m, "minute");
    }
    if (msAbs >= s) {
      return plural(ms, msAbs, s, "second");
    }
    return ms + " ms";
  }
  function plural(ms, msAbs, n, name) {
    var isPlural = msAbs >= n * 1.5;
    return Math.round(ms / n) + " " + name + (isPlural ? "s" : "");
  }
});

// node_modules/debug/src/common.js
var require_common = __commonJS((exports, module) => {
  function setup(env) {
    createDebug.debug = createDebug;
    createDebug.default = createDebug;
    createDebug.coerce = coerce;
    createDebug.disable = disable2;
    createDebug.enable = enable;
    createDebug.enabled = enabled;
    createDebug.humanize = require_ms();
    createDebug.destroy = destroy;
    Object.keys(env).forEach((key) => {
      createDebug[key] = env[key];
    });
    createDebug.names = [];
    createDebug.skips = [];
    createDebug.formatters = {};
    function selectColor(namespace) {
      let hash = 0;
      for (let i = 0;i < namespace.length; i++) {
        hash = (hash << 5) - hash + namespace.charCodeAt(i);
        hash |= 0;
      }
      return createDebug.colors[Math.abs(hash) % createDebug.colors.length];
    }
    createDebug.selectColor = selectColor;
    function createDebug(namespace) {
      let prevTime;
      let enableOverride = null;
      let namespacesCache;
      let enabledCache;
      function debug(...args) {
        if (!debug.enabled) {
          return;
        }
        const self = debug;
        const curr = Number(new Date);
        const ms = curr - (prevTime || curr);
        self.diff = ms;
        self.prev = prevTime;
        self.curr = curr;
        prevTime = curr;
        args[0] = createDebug.coerce(args[0]);
        if (typeof args[0] !== "string") {
          args.unshift("%O");
        }
        let index = 0;
        args[0] = args[0].replace(/%([a-zA-Z%])/g, (match, format) => {
          if (match === "%%") {
            return "%";
          }
          index++;
          const formatter = createDebug.formatters[format];
          if (typeof formatter === "function") {
            const val = args[index];
            match = formatter.call(self, val);
            args.splice(index, 1);
            index--;
          }
          return match;
        });
        createDebug.formatArgs.call(self, args);
        const logFn = self.log || createDebug.log;
        logFn.apply(self, args);
      }
      debug.namespace = namespace;
      debug.useColors = createDebug.useColors();
      debug.color = createDebug.selectColor(namespace);
      debug.extend = extend;
      debug.destroy = createDebug.destroy;
      Object.defineProperty(debug, "enabled", {
        enumerable: true,
        configurable: false,
        get: () => {
          if (enableOverride !== null) {
            return enableOverride;
          }
          if (namespacesCache !== createDebug.namespaces) {
            namespacesCache = createDebug.namespaces;
            enabledCache = createDebug.enabled(namespace);
          }
          return enabledCache;
        },
        set: (v) => {
          enableOverride = v;
        }
      });
      if (typeof createDebug.init === "function") {
        createDebug.init(debug);
      }
      return debug;
    }
    function extend(namespace, delimiter) {
      const newDebug = createDebug(this.namespace + (typeof delimiter === "undefined" ? ":" : delimiter) + namespace);
      newDebug.log = this.log;
      return newDebug;
    }
    function enable(namespaces) {
      createDebug.save(namespaces);
      createDebug.namespaces = namespaces;
      createDebug.names = [];
      createDebug.skips = [];
      const split = (typeof namespaces === "string" ? namespaces : "").trim().replace(/\s+/g, ",").split(",").filter(Boolean);
      for (const ns of split) {
        if (ns[0] === "-") {
          createDebug.skips.push(ns.slice(1));
        } else {
          createDebug.names.push(ns);
        }
      }
    }
    function matchesTemplate(search, template) {
      let searchIndex = 0;
      let templateIndex = 0;
      let starIndex = -1;
      let matchIndex = 0;
      while (searchIndex < search.length) {
        if (templateIndex < template.length && (template[templateIndex] === search[searchIndex] || template[templateIndex] === "*")) {
          if (template[templateIndex] === "*") {
            starIndex = templateIndex;
            matchIndex = searchIndex;
            templateIndex++;
          } else {
            searchIndex++;
            templateIndex++;
          }
        } else if (starIndex !== -1) {
          templateIndex = starIndex + 1;
          matchIndex++;
          searchIndex = matchIndex;
        } else {
          return false;
        }
      }
      while (templateIndex < template.length && template[templateIndex] === "*") {
        templateIndex++;
      }
      return templateIndex === template.length;
    }
    function disable2() {
      const namespaces = [
        ...createDebug.names,
        ...createDebug.skips.map((namespace) => "-" + namespace)
      ].join(",");
      createDebug.enable("");
      return namespaces;
    }
    function enabled(name) {
      for (const skip of createDebug.skips) {
        if (matchesTemplate(name, skip)) {
          return false;
        }
      }
      for (const ns of createDebug.names) {
        if (matchesTemplate(name, ns)) {
          return true;
        }
      }
      return false;
    }
    function coerce(val) {
      if (val instanceof Error) {
        return val.stack || val.message;
      }
      return val;
    }
    function destroy() {
      console.warn("Instance method `debug.destroy()` is deprecated and no longer does anything. It will be removed in the next major version of `debug`.");
    }
    createDebug.enable(createDebug.load());
    return createDebug;
  }
  module.exports = setup;
});

// node_modules/debug/src/browser.js
var require_browser = __commonJS((exports, module) => {
  exports.formatArgs = formatArgs;
  exports.save = save;
  exports.load = load;
  exports.useColors = useColors;
  exports.storage = localstorage();
  exports.destroy = (() => {
    let warned = false;
    return () => {
      if (!warned) {
        warned = true;
        console.warn("Instance method `debug.destroy()` is deprecated and no longer does anything. It will be removed in the next major version of `debug`.");
      }
    };
  })();
  exports.colors = [
    "#0000CC",
    "#0000FF",
    "#0033CC",
    "#0033FF",
    "#0066CC",
    "#0066FF",
    "#0099CC",
    "#0099FF",
    "#00CC00",
    "#00CC33",
    "#00CC66",
    "#00CC99",
    "#00CCCC",
    "#00CCFF",
    "#3300CC",
    "#3300FF",
    "#3333CC",
    "#3333FF",
    "#3366CC",
    "#3366FF",
    "#3399CC",
    "#3399FF",
    "#33CC00",
    "#33CC33",
    "#33CC66",
    "#33CC99",
    "#33CCCC",
    "#33CCFF",
    "#6600CC",
    "#6600FF",
    "#6633CC",
    "#6633FF",
    "#66CC00",
    "#66CC33",
    "#9900CC",
    "#9900FF",
    "#9933CC",
    "#9933FF",
    "#99CC00",
    "#99CC33",
    "#CC0000",
    "#CC0033",
    "#CC0066",
    "#CC0099",
    "#CC00CC",
    "#CC00FF",
    "#CC3300",
    "#CC3333",
    "#CC3366",
    "#CC3399",
    "#CC33CC",
    "#CC33FF",
    "#CC6600",
    "#CC6633",
    "#CC9900",
    "#CC9933",
    "#CCCC00",
    "#CCCC33",
    "#FF0000",
    "#FF0033",
    "#FF0066",
    "#FF0099",
    "#FF00CC",
    "#FF00FF",
    "#FF3300",
    "#FF3333",
    "#FF3366",
    "#FF3399",
    "#FF33CC",
    "#FF33FF",
    "#FF6600",
    "#FF6633",
    "#FF9900",
    "#FF9933",
    "#FFCC00",
    "#FFCC33"
  ];
  function useColors() {
    if (typeof window !== "undefined" && window.process && (window.process.type === "renderer" || window.process.__nwjs)) {
      return true;
    }
    if (typeof navigator !== "undefined" && navigator.userAgent && navigator.userAgent.toLowerCase().match(/(edge|trident)\/(\d+)/)) {
      return false;
    }
    let m;
    return typeof document !== "undefined" && document.documentElement && document.documentElement.style && document.documentElement.style.WebkitAppearance || typeof window !== "undefined" && window.console && (window.console.firebug || window.console.exception && window.console.table) || typeof navigator !== "undefined" && navigator.userAgent && (m = navigator.userAgent.toLowerCase().match(/firefox\/(\d+)/)) && parseInt(m[1], 10) >= 31 || typeof navigator !== "undefined" && navigator.userAgent && navigator.userAgent.toLowerCase().match(/applewebkit\/(\d+)/);
  }
  function formatArgs(args) {
    args[0] = (this.useColors ? "%c" : "") + this.namespace + (this.useColors ? " %c" : " ") + args[0] + (this.useColors ? "%c " : " ") + "+" + module.exports.humanize(this.diff);
    if (!this.useColors) {
      return;
    }
    const c = "color: " + this.color;
    args.splice(1, 0, c, "color: inherit");
    let index = 0;
    let lastC = 0;
    args[0].replace(/%[a-zA-Z%]/g, (match) => {
      if (match === "%%") {
        return;
      }
      index++;
      if (match === "%c") {
        lastC = index;
      }
    });
    args.splice(lastC, 0, c);
  }
  exports.log = console.debug || console.log || (() => {});
  function save(namespaces) {
    try {
      if (namespaces) {
        exports.storage.setItem("debug", namespaces);
      } else {
        exports.storage.removeItem("debug");
      }
    } catch (error) {}
  }
  function load() {
    let r;
    try {
      r = exports.storage.getItem("debug") || exports.storage.getItem("DEBUG");
    } catch (error) {}
    if (!r && typeof process !== "undefined" && "env" in process) {
      r = process.env.DEBUG;
    }
    return r;
  }
  function localstorage() {
    try {
      return localStorage;
    } catch (error) {}
  }
  module.exports = require_common()(exports);
  var { formatters } = module.exports;
  formatters.j = function(v) {
    try {
      return JSON.stringify(v);
    } catch (error) {
      return "[UnexpectedJSONParseError]: " + error.message;
    }
  };
});

// node_modules/debug/src/node.js
var require_node = __commonJS((exports, module) => {
  var tty = __require("tty");
  var util = __require("util");
  exports.init = init;
  exports.log = log;
  exports.formatArgs = formatArgs;
  exports.save = save;
  exports.load = load;
  exports.useColors = useColors;
  exports.destroy = util.deprecate(() => {}, "Instance method `debug.destroy()` is deprecated and no longer does anything. It will be removed in the next major version of `debug`.");
  exports.colors = [6, 2, 3, 4, 5, 1];
  try {
    const supportsColor = (()=>{throw new Error("Cannot require module "+"supports-color");})();
    if (supportsColor && (supportsColor.stderr || supportsColor).level >= 2) {
      exports.colors = [
        20,
        21,
        26,
        27,
        32,
        33,
        38,
        39,
        40,
        41,
        42,
        43,
        44,
        45,
        56,
        57,
        62,
        63,
        68,
        69,
        74,
        75,
        76,
        77,
        78,
        79,
        80,
        81,
        92,
        93,
        98,
        99,
        112,
        113,
        128,
        129,
        134,
        135,
        148,
        149,
        160,
        161,
        162,
        163,
        164,
        165,
        166,
        167,
        168,
        169,
        170,
        171,
        172,
        173,
        178,
        179,
        184,
        185,
        196,
        197,
        198,
        199,
        200,
        201,
        202,
        203,
        204,
        205,
        206,
        207,
        208,
        209,
        214,
        215,
        220,
        221
      ];
    }
  } catch (error) {}
  exports.inspectOpts = Object.keys(process.env).filter((key) => {
    return /^debug_/i.test(key);
  }).reduce((obj, key) => {
    const prop = key.substring(6).toLowerCase().replace(/_([a-z])/g, (_, k) => {
      return k.toUpperCase();
    });
    let val = process.env[key];
    if (/^(yes|on|true|enabled)$/i.test(val)) {
      val = true;
    } else if (/^(no|off|false|disabled)$/i.test(val)) {
      val = false;
    } else if (val === "null") {
      val = null;
    } else {
      val = Number(val);
    }
    obj[prop] = val;
    return obj;
  }, {});
  function useColors() {
    return "colors" in exports.inspectOpts ? Boolean(exports.inspectOpts.colors) : tty.isatty(process.stderr.fd);
  }
  function formatArgs(args) {
    const { namespace: name, useColors: useColors2 } = this;
    if (useColors2) {
      const c = this.color;
      const colorCode = "\x1B[3" + (c < 8 ? c : "8;5;" + c);
      const prefix = `  ${colorCode};1m${name} \x1B[0m`;
      args[0] = prefix + args[0].split(`
`).join(`
` + prefix);
      args.push(colorCode + "m+" + module.exports.humanize(this.diff) + "\x1B[0m");
    } else {
      args[0] = getDate() + name + " " + args[0];
    }
  }
  function getDate() {
    if (exports.inspectOpts.hideDate) {
      return "";
    }
    return new Date().toISOString() + " ";
  }
  function log(...args) {
    return process.stderr.write(util.formatWithOptions(exports.inspectOpts, ...args) + `
`);
  }
  function save(namespaces) {
    if (namespaces) {
      process.env.DEBUG = namespaces;
    } else {
      delete process.env.DEBUG;
    }
  }
  function load() {
    return process.env.DEBUG;
  }
  function init(debug) {
    debug.inspectOpts = {};
    const keys = Object.keys(exports.inspectOpts);
    for (let i = 0;i < keys.length; i++) {
      debug.inspectOpts[keys[i]] = exports.inspectOpts[keys[i]];
    }
  }
  module.exports = require_common()(exports);
  var { formatters } = module.exports;
  formatters.o = function(v) {
    this.inspectOpts.colors = this.useColors;
    return util.inspect(v, this.inspectOpts).split(`
`).map((str) => str.trim()).join(" ");
  };
  formatters.O = function(v) {
    this.inspectOpts.colors = this.useColors;
    return util.inspect(v, this.inspectOpts);
  };
});

// node_modules/debug/src/index.js
var require_src = __commonJS((exports, module) => {
  if (typeof process === "undefined" || process.type === "renderer" || false || process.__nwjs) {
    module.exports = require_browser();
  } else {
    module.exports = require_node();
  }
});

// src/config.ts
var exports_config = {};
__export(exports_config, {
  trackerValidationEntrypointPath: () => trackerValidationEntrypointPath2,
  trackerDatabasePath: () => trackerDatabasePath,
  trackerConfigPath: () => trackerConfigPath2,
  trackerBackendScriptPath: () => trackerBackendScriptPath2,
  stateDirName: () => stateDirName2,
  projectRootFrom: () => projectRootFrom2,
  loadTrackerConfig: () => loadTrackerConfig2,
  loadEnvFiles: () => loadEnvFiles2,
  initTrackerProject: () => initTrackerProject2,
  initTrackerPresets: () => initTrackerPresets2
});
import { existsSync as existsSync4, mkdirSync as mkdirSync3, readFileSync as readFileSync3, writeFileSync as writeFileSync3 } from "node:fs";
import { dirname as dirname2, join as join3, resolve as resolve3 } from "node:path";
import { fileURLToPath as fileURLToPath2 } from "node:url";
function trackerBackendScriptPath2() {
  const candidates = [
    fileURLToPath2(new URL("../backend/tracker-local.py", import.meta.url)),
    fileURLToPath2(new URL("../../backend/tracker-local.py", import.meta.url))
  ];
  return candidates.find((candidate) => existsSync4(candidate)) ?? candidates[0];
}
function stateDirName2() {
  return process.env.VOLTER_STATE_DIR || ".volter";
}
function trackerConfigPath2(projectRoot) {
  return join3(projectRoot, stateDirName2(), "tracker-config.json");
}
function initTrackerPresets2() {
  return INIT_TRACKER_PRESETS2;
}
function presetTemplate2() {
  return readFileSync3(fileURLToPath2(new URL("../boilerplates/presets/preset.cjs", import.meta.url)), "utf8");
}
function trackerValidationEntrypointPath2(projectRoot) {
  return join3(projectRoot, stateDirName2(), "tracker", "validation", "preset.cjs");
}
function presetBooleans2(preset) {
  return {
    __ZTRACK_PRESET_NAME__: preset,
    __ZTRACK_REQUIRE_SOURCE_MARKER__: preset === "basic" ? "false" : "true",
    __ZTRACK_REQUIRE_SDLC_GATES__: preset === "simple-sdlc" ? "true" : "false",
    __ZTRACK_REQUIRE_SPEC_SECTIONS__: preset === "simple-spec" ? "true" : "false",
    __ZTRACK_REQUIRE_SPECKIT_SECTIONS__: preset === "speckit" ? "true" : "false"
  };
}
function installedPresetTemplate2(preset) {
  let text4 = presetTemplate2();
  for (const [token, value] of Object.entries(presetBooleans2(preset))) {
    text4 = text4.replaceAll(token, value);
  }
  return text4;
}
function installPreset2(projectRoot, preset) {
  const entrypoint = trackerValidationEntrypointPath2(projectRoot);
  mkdirSync3(dirname2(entrypoint), { recursive: true });
  if (!existsSync4(entrypoint))
    writeFileSync3(entrypoint, `${installedPresetTemplate2(preset)}
`);
  return entrypoint;
}
function initTrackerProject2(root, teamKey = "LOCAL", options = {}) {
  const configPath = trackerConfigPath2(root);
  const preset = options.preset ?? "basic";
  if (existsSync4(configPath))
    return { configPath, alreadyInitialized: true, teamKey, preset };
  const key = teamKey.toUpperCase();
  mkdirSync3(dirname2(configPath), { recursive: true });
  const validationEntrypoint = installPreset2(root, preset);
  const config = {
    backend: "local",
    local: { teamKey: key },
    validation: {
      entrypoint: `${stateDirName2()}/tracker/validation/preset.cjs`,
      installedFrom: preset
    },
    organization: { check: { categories: { sourced: 1, code: 2 } } }
  };
  writeFileSync3(configPath, `${JSON.stringify(config, null, 2)}
`);
  const gitignorePath = resolve3(root, ".gitignore");
  const ignoreMarker = "# ztrack (added by ztrack init)";
  const stateDir = stateDirName2();
  const ignoreBlock = [
    ignoreMarker,
    `${stateDir}/tracker/tracker.sqlite`,
    `${stateDir}/tracker/tracker.sqlite-*`,
    `${stateDir}/tracker/tracker.sqlite.lock`,
    `${stateDir}/tracker/local-store.json`,
    `${stateDir}/tracker/markdown/`,
    `${stateDir}/agent-dispatch/`,
    ""
  ].join(`
`);
  const existingIgnore = existsSync4(gitignorePath) ? readFileSync3(gitignorePath, "utf8") : "";
  if (!existingIgnore.includes(ignoreMarker)) {
    const prefix = existingIgnore && !existingIgnore.endsWith(`
`) ? `
` : "";
    writeFileSync3(gitignorePath, `${existingIgnore}${prefix}${existingIgnore ? `
` : ""}${ignoreBlock}`);
  }
  return { configPath, alreadyInitialized: false, teamKey: key, preset, ...validationEntrypoint ? { validationEntrypoint } : {} };
}
function projectRootFrom2(start = process.cwd()) {
  let current = resolve3(start);
  while (true) {
    if (existsSync4(trackerConfigPath2(current)))
      return current;
    const parent = dirname2(current);
    if (parent === current)
      return resolve3(start);
    current = parent;
  }
}
function loadTrackerConfig2(projectRoot = projectRootFrom2()) {
  const configPath = trackerConfigPath2(projectRoot);
  if (!existsSync4(configPath)) {
    throw new Error(`No tracker config found at ${configPath}. Run 'ztrack init' to create one.`);
  }
  let raw;
  try {
    raw = JSON.parse(readFileSync3(configPath, "utf8"));
  } catch (error) {
    throw new Error(`Tracker config at ${configPath} is not valid JSON: ${error.message}`);
  }
  return { ...raw, backend: raw.backend === "markdown" ? "markdown" : "local" };
}
function trackerDatabasePath(projectRoot = projectRootFrom2()) {
  const config = loadTrackerConfig2(projectRoot);
  const database = config.local?.database || join3(stateDirName2(), "tracker", "tracker.sqlite");
  return database.startsWith("/") ? database : resolve3(projectRoot, database);
}
function loadEnvFiles2(projectRoot) {
  for (const envPath of [join3(projectRoot, ".env"), join3(projectRoot, stateDirName2(), "secrets.env")]) {
    if (!existsSync4(envPath))
      continue;
    for (const line of readFileSync3(envPath, "utf8").split(`
`)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("="))
        continue;
      const [key, ...rest] = trimmed.split("=");
      process.env[key.trim()] ??= rest.join("=").trim().replace(/^['"]|['"]$/g, "");
    }
  }
}
var INIT_TRACKER_PRESETS2;
var init_config = __esm(() => {
  INIT_TRACKER_PRESETS2 = ["basic", "simple-sdlc", "simple-spec", "speckit"];
});

// src/cli.ts
import { createHash as createHash5 } from "crypto";
import { spawn as spawn2, spawnSync } from "child_process";
import { existsSync as existsSync6, readFileSync as readFileSync7, writeFileSync as writeFileSync6 } from "fs";
import { dirname as dirname3, isAbsolute as isAbsolute5, join as join5, resolve as resolve6 } from "path";
import { fileURLToPath as fileURLToPath3 } from "url";

// src/config.ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
function trackerBackendScriptPath() {
  const candidates = [
    fileURLToPath(new URL("../backend/tracker-local.py", import.meta.url)),
    fileURLToPath(new URL("../../backend/tracker-local.py", import.meta.url))
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0];
}
function stateDirName() {
  return process.env.VOLTER_STATE_DIR || ".volter";
}
function trackerConfigPath(projectRoot) {
  return join(projectRoot, stateDirName(), "tracker-config.json");
}
var INIT_TRACKER_PRESETS = ["basic", "simple-sdlc", "simple-spec", "speckit"];
function initTrackerPresets() {
  return INIT_TRACKER_PRESETS;
}
function presetTemplate() {
  return readFileSync(fileURLToPath(new URL("../boilerplates/presets/preset.cjs", import.meta.url)), "utf8");
}
function trackerValidationEntrypointPath(projectRoot) {
  return join(projectRoot, stateDirName(), "tracker", "validation", "preset.cjs");
}
function presetBooleans(preset) {
  return {
    __ZTRACK_PRESET_NAME__: preset,
    __ZTRACK_REQUIRE_SOURCE_MARKER__: preset === "basic" ? "false" : "true",
    __ZTRACK_REQUIRE_SDLC_GATES__: preset === "simple-sdlc" ? "true" : "false",
    __ZTRACK_REQUIRE_SPEC_SECTIONS__: preset === "simple-spec" ? "true" : "false",
    __ZTRACK_REQUIRE_SPECKIT_SECTIONS__: preset === "speckit" ? "true" : "false"
  };
}
function installedPresetTemplate(preset) {
  let text = presetTemplate();
  for (const [token, value] of Object.entries(presetBooleans(preset))) {
    text = text.replaceAll(token, value);
  }
  return text;
}
function installPreset(projectRoot, preset) {
  const entrypoint = trackerValidationEntrypointPath(projectRoot);
  mkdirSync(dirname(entrypoint), { recursive: true });
  if (!existsSync(entrypoint))
    writeFileSync(entrypoint, `${installedPresetTemplate(preset)}
`);
  return entrypoint;
}
function initTrackerProject(root, teamKey = "LOCAL", options = {}) {
  const configPath = trackerConfigPath(root);
  const preset = options.preset ?? "basic";
  if (existsSync(configPath))
    return { configPath, alreadyInitialized: true, teamKey, preset };
  const key = teamKey.toUpperCase();
  mkdirSync(dirname(configPath), { recursive: true });
  const validationEntrypoint = installPreset(root, preset);
  const config = {
    backend: "local",
    local: { teamKey: key },
    validation: {
      entrypoint: `${stateDirName()}/tracker/validation/preset.cjs`,
      installedFrom: preset
    },
    organization: { check: { categories: { sourced: 1, code: 2 } } }
  };
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}
`);
  const gitignorePath = resolve(root, ".gitignore");
  const ignoreMarker = "# ztrack (added by ztrack init)";
  const stateDir = stateDirName();
  const ignoreBlock = [
    ignoreMarker,
    `${stateDir}/tracker/tracker.sqlite`,
    `${stateDir}/tracker/tracker.sqlite-*`,
    `${stateDir}/tracker/tracker.sqlite.lock`,
    `${stateDir}/tracker/local-store.json`,
    `${stateDir}/tracker/markdown/`,
    `${stateDir}/agent-dispatch/`,
    ""
  ].join(`
`);
  const existingIgnore = existsSync(gitignorePath) ? readFileSync(gitignorePath, "utf8") : "";
  if (!existingIgnore.includes(ignoreMarker)) {
    const prefix = existingIgnore && !existingIgnore.endsWith(`
`) ? `
` : "";
    writeFileSync(gitignorePath, `${existingIgnore}${prefix}${existingIgnore ? `
` : ""}${ignoreBlock}`);
  }
  return { configPath, alreadyInitialized: false, teamKey: key, preset, ...validationEntrypoint ? { validationEntrypoint } : {} };
}
function projectRootFrom(start = process.cwd()) {
  let current = resolve(start);
  while (true) {
    if (existsSync(trackerConfigPath(current)))
      return current;
    const parent = dirname(current);
    if (parent === current)
      return resolve(start);
    current = parent;
  }
}
function loadTrackerConfig(projectRoot = projectRootFrom()) {
  const configPath = trackerConfigPath(projectRoot);
  if (!existsSync(configPath)) {
    throw new Error(`No tracker config found at ${configPath}. Run 'ztrack init' to create one.`);
  }
  let raw;
  try {
    raw = JSON.parse(readFileSync(configPath, "utf8"));
  } catch (error) {
    throw new Error(`Tracker config at ${configPath} is not valid JSON: ${error.message}`);
  }
  return { ...raw, backend: raw.backend === "markdown" ? "markdown" : "local" };
}
function loadEnvFiles(projectRoot) {
  for (const envPath of [join(projectRoot, ".env"), join(projectRoot, stateDirName(), "secrets.env")]) {
    if (!existsSync(envPath))
      continue;
    for (const line of readFileSync(envPath, "utf8").split(`
`)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("="))
        continue;
      const [key, ...rest] = trimmed.split("=");
      process.env[key.trim()] ??= rest.join("=").trim().replace(/^['"]|['"]$/g, "");
    }
  }
}

// src/presetRegistry.ts
import { existsSync as existsSync2 } from "node:fs";
import { createRequire as createRequire2 } from "node:module";
import { isAbsolute, resolve as resolve2 } from "node:path";
function resolveTrackerPreset(value) {
  throw new Error(value ? `Unsupported legacy organization.validationPreset '${value}'. Run 'ztrack init --preset basic' to install repo-local validation.` : "No tracker validation entrypoint configured. Run 'ztrack init --preset basic' to install .volter/tracker/validation/preset.cjs.");
}
function assertTrackerPresetRuntime(value, source) {
  if (!value || typeof value !== "object") {
    throw new Error(`Validation entrypoint ${source} did not export a tracker preset runtime object`);
  }
  const runtime = value;
  if (typeof runtime.name !== "string" || typeof runtime.parseIssueMarkdown !== "function" || typeof runtime.markdownDiagnostics !== "function") {
    throw new Error(`Validation entrypoint ${source} is missing required tracker preset runtime fields`);
  }
  return runtime;
}
function loadValidationEntrypoint(entrypoint, projectRoot) {
  const absolutePath = isAbsolute(entrypoint) ? entrypoint : resolve2(projectRoot, entrypoint);
  if (!existsSync2(absolutePath)) {
    throw new Error(`Configured tracker validation entrypoint does not exist: ${absolutePath}`);
  }
  const require2 = createRequire2(import.meta.url);
  const loaded = require2(absolutePath);
  const candidate = loaded && typeof loaded === "object" ? loaded.preset ?? loaded.default ?? loaded : loaded;
  return assertTrackerPresetRuntime(candidate, absolutePath);
}
function resolveTrackerValidation(config, projectRoot = process.cwd()) {
  const entrypoint = config.validation?.entrypoint?.trim();
  if (entrypoint)
    return loadValidationEntrypoint(entrypoint, projectRoot);
  return resolveTrackerPreset(config.organization?.validationPreset);
}

// src/check.ts
function checkTrackerSnapshot(rawSnapshot, options = {}) {
  const projectRoot = options.projectRoot ?? projectRootFrom();
  const config = options.config ?? loadTrackerConfig(projectRoot);
  const preset = resolveTrackerValidation(config, projectRoot);
  const checkSnapshot = preset.snapshot?.checkSnapshot;
  if (!checkSnapshot)
    throw new Error("Active tracker preset does not implement snapshot.checkSnapshot");
  return checkSnapshot(rawSnapshot, options);
}

// node_modules/devlop/lib/development.js
var codesWarned = new Set;

class AssertionError extends Error {
  name = "Assertion";
  code = "ERR_ASSERTION";
  constructor(message, actual, expected, operator, generated) {
    super(message);
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
    this.actual = actual;
    this.expected = expected;
    this.generated = generated;
    this.operator = operator;
  }
}
function ok(value, message) {
  assert(Boolean(value), false, true, "ok", "Expected value to be truthy", message);
}
function assert(bool, actual, expected, operator, defaultMessage, userMessage) {
  if (!bool) {
    throw userMessage instanceof Error ? userMessage : new AssertionError(userMessage || defaultMessage, actual, expected, operator, !userMessage);
  }
}

// node_modules/mdast-util-to-string/lib/index.js
var emptyOptions = {};
function toString(value, options) {
  const settings = options || emptyOptions;
  const includeImageAlt = typeof settings.includeImageAlt === "boolean" ? settings.includeImageAlt : true;
  const includeHtml = typeof settings.includeHtml === "boolean" ? settings.includeHtml : true;
  return one(value, includeImageAlt, includeHtml);
}
function one(value, includeImageAlt, includeHtml) {
  if (node(value)) {
    if ("value" in value) {
      return value.type === "html" && !includeHtml ? "" : value.value;
    }
    if (includeImageAlt && "alt" in value && value.alt) {
      return value.alt;
    }
    if ("children" in value) {
      return all(value.children, includeImageAlt, includeHtml);
    }
  }
  if (Array.isArray(value)) {
    return all(value, includeImageAlt, includeHtml);
  }
  return "";
}
function all(values, includeImageAlt, includeHtml) {
  const result = [];
  let index = -1;
  while (++index < values.length) {
    result[index] = one(values[index], includeImageAlt, includeHtml);
  }
  return result.join("");
}
function node(value) {
  return Boolean(value && typeof value === "object");
}
// node_modules/character-entities/index.js
var characterEntities = {
  AElig: "Æ",
  AMP: "&",
  Aacute: "Á",
  Abreve: "Ă",
  Acirc: "Â",
  Acy: "А",
  Afr: "\uD835\uDD04",
  Agrave: "À",
  Alpha: "Α",
  Amacr: "Ā",
  And: "⩓",
  Aogon: "Ą",
  Aopf: "\uD835\uDD38",
  ApplyFunction: "⁡",
  Aring: "Å",
  Ascr: "\uD835\uDC9C",
  Assign: "≔",
  Atilde: "Ã",
  Auml: "Ä",
  Backslash: "∖",
  Barv: "⫧",
  Barwed: "⌆",
  Bcy: "Б",
  Because: "∵",
  Bernoullis: "ℬ",
  Beta: "Β",
  Bfr: "\uD835\uDD05",
  Bopf: "\uD835\uDD39",
  Breve: "˘",
  Bscr: "ℬ",
  Bumpeq: "≎",
  CHcy: "Ч",
  COPY: "©",
  Cacute: "Ć",
  Cap: "⋒",
  CapitalDifferentialD: "ⅅ",
  Cayleys: "ℭ",
  Ccaron: "Č",
  Ccedil: "Ç",
  Ccirc: "Ĉ",
  Cconint: "∰",
  Cdot: "Ċ",
  Cedilla: "¸",
  CenterDot: "·",
  Cfr: "ℭ",
  Chi: "Χ",
  CircleDot: "⊙",
  CircleMinus: "⊖",
  CirclePlus: "⊕",
  CircleTimes: "⊗",
  ClockwiseContourIntegral: "∲",
  CloseCurlyDoubleQuote: "”",
  CloseCurlyQuote: "’",
  Colon: "∷",
  Colone: "⩴",
  Congruent: "≡",
  Conint: "∯",
  ContourIntegral: "∮",
  Copf: "ℂ",
  Coproduct: "∐",
  CounterClockwiseContourIntegral: "∳",
  Cross: "⨯",
  Cscr: "\uD835\uDC9E",
  Cup: "⋓",
  CupCap: "≍",
  DD: "ⅅ",
  DDotrahd: "⤑",
  DJcy: "Ђ",
  DScy: "Ѕ",
  DZcy: "Џ",
  Dagger: "‡",
  Darr: "↡",
  Dashv: "⫤",
  Dcaron: "Ď",
  Dcy: "Д",
  Del: "∇",
  Delta: "Δ",
  Dfr: "\uD835\uDD07",
  DiacriticalAcute: "´",
  DiacriticalDot: "˙",
  DiacriticalDoubleAcute: "˝",
  DiacriticalGrave: "`",
  DiacriticalTilde: "˜",
  Diamond: "⋄",
  DifferentialD: "ⅆ",
  Dopf: "\uD835\uDD3B",
  Dot: "¨",
  DotDot: "⃜",
  DotEqual: "≐",
  DoubleContourIntegral: "∯",
  DoubleDot: "¨",
  DoubleDownArrow: "⇓",
  DoubleLeftArrow: "⇐",
  DoubleLeftRightArrow: "⇔",
  DoubleLeftTee: "⫤",
  DoubleLongLeftArrow: "⟸",
  DoubleLongLeftRightArrow: "⟺",
  DoubleLongRightArrow: "⟹",
  DoubleRightArrow: "⇒",
  DoubleRightTee: "⊨",
  DoubleUpArrow: "⇑",
  DoubleUpDownArrow: "⇕",
  DoubleVerticalBar: "∥",
  DownArrow: "↓",
  DownArrowBar: "⤓",
  DownArrowUpArrow: "⇵",
  DownBreve: "̑",
  DownLeftRightVector: "⥐",
  DownLeftTeeVector: "⥞",
  DownLeftVector: "↽",
  DownLeftVectorBar: "⥖",
  DownRightTeeVector: "⥟",
  DownRightVector: "⇁",
  DownRightVectorBar: "⥗",
  DownTee: "⊤",
  DownTeeArrow: "↧",
  Downarrow: "⇓",
  Dscr: "\uD835\uDC9F",
  Dstrok: "Đ",
  ENG: "Ŋ",
  ETH: "Ð",
  Eacute: "É",
  Ecaron: "Ě",
  Ecirc: "Ê",
  Ecy: "Э",
  Edot: "Ė",
  Efr: "\uD835\uDD08",
  Egrave: "È",
  Element: "∈",
  Emacr: "Ē",
  EmptySmallSquare: "◻",
  EmptyVerySmallSquare: "▫",
  Eogon: "Ę",
  Eopf: "\uD835\uDD3C",
  Epsilon: "Ε",
  Equal: "⩵",
  EqualTilde: "≂",
  Equilibrium: "⇌",
  Escr: "ℰ",
  Esim: "⩳",
  Eta: "Η",
  Euml: "Ë",
  Exists: "∃",
  ExponentialE: "ⅇ",
  Fcy: "Ф",
  Ffr: "\uD835\uDD09",
  FilledSmallSquare: "◼",
  FilledVerySmallSquare: "▪",
  Fopf: "\uD835\uDD3D",
  ForAll: "∀",
  Fouriertrf: "ℱ",
  Fscr: "ℱ",
  GJcy: "Ѓ",
  GT: ">",
  Gamma: "Γ",
  Gammad: "Ϝ",
  Gbreve: "Ğ",
  Gcedil: "Ģ",
  Gcirc: "Ĝ",
  Gcy: "Г",
  Gdot: "Ġ",
  Gfr: "\uD835\uDD0A",
  Gg: "⋙",
  Gopf: "\uD835\uDD3E",
  GreaterEqual: "≥",
  GreaterEqualLess: "⋛",
  GreaterFullEqual: "≧",
  GreaterGreater: "⪢",
  GreaterLess: "≷",
  GreaterSlantEqual: "⩾",
  GreaterTilde: "≳",
  Gscr: "\uD835\uDCA2",
  Gt: "≫",
  HARDcy: "Ъ",
  Hacek: "ˇ",
  Hat: "^",
  Hcirc: "Ĥ",
  Hfr: "ℌ",
  HilbertSpace: "ℋ",
  Hopf: "ℍ",
  HorizontalLine: "─",
  Hscr: "ℋ",
  Hstrok: "Ħ",
  HumpDownHump: "≎",
  HumpEqual: "≏",
  IEcy: "Е",
  IJlig: "Ĳ",
  IOcy: "Ё",
  Iacute: "Í",
  Icirc: "Î",
  Icy: "И",
  Idot: "İ",
  Ifr: "ℑ",
  Igrave: "Ì",
  Im: "ℑ",
  Imacr: "Ī",
  ImaginaryI: "ⅈ",
  Implies: "⇒",
  Int: "∬",
  Integral: "∫",
  Intersection: "⋂",
  InvisibleComma: "⁣",
  InvisibleTimes: "⁢",
  Iogon: "Į",
  Iopf: "\uD835\uDD40",
  Iota: "Ι",
  Iscr: "ℐ",
  Itilde: "Ĩ",
  Iukcy: "І",
  Iuml: "Ï",
  Jcirc: "Ĵ",
  Jcy: "Й",
  Jfr: "\uD835\uDD0D",
  Jopf: "\uD835\uDD41",
  Jscr: "\uD835\uDCA5",
  Jsercy: "Ј",
  Jukcy: "Є",
  KHcy: "Х",
  KJcy: "Ќ",
  Kappa: "Κ",
  Kcedil: "Ķ",
  Kcy: "К",
  Kfr: "\uD835\uDD0E",
  Kopf: "\uD835\uDD42",
  Kscr: "\uD835\uDCA6",
  LJcy: "Љ",
  LT: "<",
  Lacute: "Ĺ",
  Lambda: "Λ",
  Lang: "⟪",
  Laplacetrf: "ℒ",
  Larr: "↞",
  Lcaron: "Ľ",
  Lcedil: "Ļ",
  Lcy: "Л",
  LeftAngleBracket: "⟨",
  LeftArrow: "←",
  LeftArrowBar: "⇤",
  LeftArrowRightArrow: "⇆",
  LeftCeiling: "⌈",
  LeftDoubleBracket: "⟦",
  LeftDownTeeVector: "⥡",
  LeftDownVector: "⇃",
  LeftDownVectorBar: "⥙",
  LeftFloor: "⌊",
  LeftRightArrow: "↔",
  LeftRightVector: "⥎",
  LeftTee: "⊣",
  LeftTeeArrow: "↤",
  LeftTeeVector: "⥚",
  LeftTriangle: "⊲",
  LeftTriangleBar: "⧏",
  LeftTriangleEqual: "⊴",
  LeftUpDownVector: "⥑",
  LeftUpTeeVector: "⥠",
  LeftUpVector: "↿",
  LeftUpVectorBar: "⥘",
  LeftVector: "↼",
  LeftVectorBar: "⥒",
  Leftarrow: "⇐",
  Leftrightarrow: "⇔",
  LessEqualGreater: "⋚",
  LessFullEqual: "≦",
  LessGreater: "≶",
  LessLess: "⪡",
  LessSlantEqual: "⩽",
  LessTilde: "≲",
  Lfr: "\uD835\uDD0F",
  Ll: "⋘",
  Lleftarrow: "⇚",
  Lmidot: "Ŀ",
  LongLeftArrow: "⟵",
  LongLeftRightArrow: "⟷",
  LongRightArrow: "⟶",
  Longleftarrow: "⟸",
  Longleftrightarrow: "⟺",
  Longrightarrow: "⟹",
  Lopf: "\uD835\uDD43",
  LowerLeftArrow: "↙",
  LowerRightArrow: "↘",
  Lscr: "ℒ",
  Lsh: "↰",
  Lstrok: "Ł",
  Lt: "≪",
  Map: "⤅",
  Mcy: "М",
  MediumSpace: " ",
  Mellintrf: "ℳ",
  Mfr: "\uD835\uDD10",
  MinusPlus: "∓",
  Mopf: "\uD835\uDD44",
  Mscr: "ℳ",
  Mu: "Μ",
  NJcy: "Њ",
  Nacute: "Ń",
  Ncaron: "Ň",
  Ncedil: "Ņ",
  Ncy: "Н",
  NegativeMediumSpace: "​",
  NegativeThickSpace: "​",
  NegativeThinSpace: "​",
  NegativeVeryThinSpace: "​",
  NestedGreaterGreater: "≫",
  NestedLessLess: "≪",
  NewLine: `
`,
  Nfr: "\uD835\uDD11",
  NoBreak: "⁠",
  NonBreakingSpace: " ",
  Nopf: "ℕ",
  Not: "⫬",
  NotCongruent: "≢",
  NotCupCap: "≭",
  NotDoubleVerticalBar: "∦",
  NotElement: "∉",
  NotEqual: "≠",
  NotEqualTilde: "≂̸",
  NotExists: "∄",
  NotGreater: "≯",
  NotGreaterEqual: "≱",
  NotGreaterFullEqual: "≧̸",
  NotGreaterGreater: "≫̸",
  NotGreaterLess: "≹",
  NotGreaterSlantEqual: "⩾̸",
  NotGreaterTilde: "≵",
  NotHumpDownHump: "≎̸",
  NotHumpEqual: "≏̸",
  NotLeftTriangle: "⋪",
  NotLeftTriangleBar: "⧏̸",
  NotLeftTriangleEqual: "⋬",
  NotLess: "≮",
  NotLessEqual: "≰",
  NotLessGreater: "≸",
  NotLessLess: "≪̸",
  NotLessSlantEqual: "⩽̸",
  NotLessTilde: "≴",
  NotNestedGreaterGreater: "⪢̸",
  NotNestedLessLess: "⪡̸",
  NotPrecedes: "⊀",
  NotPrecedesEqual: "⪯̸",
  NotPrecedesSlantEqual: "⋠",
  NotReverseElement: "∌",
  NotRightTriangle: "⋫",
  NotRightTriangleBar: "⧐̸",
  NotRightTriangleEqual: "⋭",
  NotSquareSubset: "⊏̸",
  NotSquareSubsetEqual: "⋢",
  NotSquareSuperset: "⊐̸",
  NotSquareSupersetEqual: "⋣",
  NotSubset: "⊂⃒",
  NotSubsetEqual: "⊈",
  NotSucceeds: "⊁",
  NotSucceedsEqual: "⪰̸",
  NotSucceedsSlantEqual: "⋡",
  NotSucceedsTilde: "≿̸",
  NotSuperset: "⊃⃒",
  NotSupersetEqual: "⊉",
  NotTilde: "≁",
  NotTildeEqual: "≄",
  NotTildeFullEqual: "≇",
  NotTildeTilde: "≉",
  NotVerticalBar: "∤",
  Nscr: "\uD835\uDCA9",
  Ntilde: "Ñ",
  Nu: "Ν",
  OElig: "Œ",
  Oacute: "Ó",
  Ocirc: "Ô",
  Ocy: "О",
  Odblac: "Ő",
  Ofr: "\uD835\uDD12",
  Ograve: "Ò",
  Omacr: "Ō",
  Omega: "Ω",
  Omicron: "Ο",
  Oopf: "\uD835\uDD46",
  OpenCurlyDoubleQuote: "“",
  OpenCurlyQuote: "‘",
  Or: "⩔",
  Oscr: "\uD835\uDCAA",
  Oslash: "Ø",
  Otilde: "Õ",
  Otimes: "⨷",
  Ouml: "Ö",
  OverBar: "‾",
  OverBrace: "⏞",
  OverBracket: "⎴",
  OverParenthesis: "⏜",
  PartialD: "∂",
  Pcy: "П",
  Pfr: "\uD835\uDD13",
  Phi: "Φ",
  Pi: "Π",
  PlusMinus: "±",
  Poincareplane: "ℌ",
  Popf: "ℙ",
  Pr: "⪻",
  Precedes: "≺",
  PrecedesEqual: "⪯",
  PrecedesSlantEqual: "≼",
  PrecedesTilde: "≾",
  Prime: "″",
  Product: "∏",
  Proportion: "∷",
  Proportional: "∝",
  Pscr: "\uD835\uDCAB",
  Psi: "Ψ",
  QUOT: '"',
  Qfr: "\uD835\uDD14",
  Qopf: "ℚ",
  Qscr: "\uD835\uDCAC",
  RBarr: "⤐",
  REG: "®",
  Racute: "Ŕ",
  Rang: "⟫",
  Rarr: "↠",
  Rarrtl: "⤖",
  Rcaron: "Ř",
  Rcedil: "Ŗ",
  Rcy: "Р",
  Re: "ℜ",
  ReverseElement: "∋",
  ReverseEquilibrium: "⇋",
  ReverseUpEquilibrium: "⥯",
  Rfr: "ℜ",
  Rho: "Ρ",
  RightAngleBracket: "⟩",
  RightArrow: "→",
  RightArrowBar: "⇥",
  RightArrowLeftArrow: "⇄",
  RightCeiling: "⌉",
  RightDoubleBracket: "⟧",
  RightDownTeeVector: "⥝",
  RightDownVector: "⇂",
  RightDownVectorBar: "⥕",
  RightFloor: "⌋",
  RightTee: "⊢",
  RightTeeArrow: "↦",
  RightTeeVector: "⥛",
  RightTriangle: "⊳",
  RightTriangleBar: "⧐",
  RightTriangleEqual: "⊵",
  RightUpDownVector: "⥏",
  RightUpTeeVector: "⥜",
  RightUpVector: "↾",
  RightUpVectorBar: "⥔",
  RightVector: "⇀",
  RightVectorBar: "⥓",
  Rightarrow: "⇒",
  Ropf: "ℝ",
  RoundImplies: "⥰",
  Rrightarrow: "⇛",
  Rscr: "ℛ",
  Rsh: "↱",
  RuleDelayed: "⧴",
  SHCHcy: "Щ",
  SHcy: "Ш",
  SOFTcy: "Ь",
  Sacute: "Ś",
  Sc: "⪼",
  Scaron: "Š",
  Scedil: "Ş",
  Scirc: "Ŝ",
  Scy: "С",
  Sfr: "\uD835\uDD16",
  ShortDownArrow: "↓",
  ShortLeftArrow: "←",
  ShortRightArrow: "→",
  ShortUpArrow: "↑",
  Sigma: "Σ",
  SmallCircle: "∘",
  Sopf: "\uD835\uDD4A",
  Sqrt: "√",
  Square: "□",
  SquareIntersection: "⊓",
  SquareSubset: "⊏",
  SquareSubsetEqual: "⊑",
  SquareSuperset: "⊐",
  SquareSupersetEqual: "⊒",
  SquareUnion: "⊔",
  Sscr: "\uD835\uDCAE",
  Star: "⋆",
  Sub: "⋐",
  Subset: "⋐",
  SubsetEqual: "⊆",
  Succeeds: "≻",
  SucceedsEqual: "⪰",
  SucceedsSlantEqual: "≽",
  SucceedsTilde: "≿",
  SuchThat: "∋",
  Sum: "∑",
  Sup: "⋑",
  Superset: "⊃",
  SupersetEqual: "⊇",
  Supset: "⋑",
  THORN: "Þ",
  TRADE: "™",
  TSHcy: "Ћ",
  TScy: "Ц",
  Tab: "\t",
  Tau: "Τ",
  Tcaron: "Ť",
  Tcedil: "Ţ",
  Tcy: "Т",
  Tfr: "\uD835\uDD17",
  Therefore: "∴",
  Theta: "Θ",
  ThickSpace: "  ",
  ThinSpace: " ",
  Tilde: "∼",
  TildeEqual: "≃",
  TildeFullEqual: "≅",
  TildeTilde: "≈",
  Topf: "\uD835\uDD4B",
  TripleDot: "⃛",
  Tscr: "\uD835\uDCAF",
  Tstrok: "Ŧ",
  Uacute: "Ú",
  Uarr: "↟",
  Uarrocir: "⥉",
  Ubrcy: "Ў",
  Ubreve: "Ŭ",
  Ucirc: "Û",
  Ucy: "У",
  Udblac: "Ű",
  Ufr: "\uD835\uDD18",
  Ugrave: "Ù",
  Umacr: "Ū",
  UnderBar: "_",
  UnderBrace: "⏟",
  UnderBracket: "⎵",
  UnderParenthesis: "⏝",
  Union: "⋃",
  UnionPlus: "⊎",
  Uogon: "Ų",
  Uopf: "\uD835\uDD4C",
  UpArrow: "↑",
  UpArrowBar: "⤒",
  UpArrowDownArrow: "⇅",
  UpDownArrow: "↕",
  UpEquilibrium: "⥮",
  UpTee: "⊥",
  UpTeeArrow: "↥",
  Uparrow: "⇑",
  Updownarrow: "⇕",
  UpperLeftArrow: "↖",
  UpperRightArrow: "↗",
  Upsi: "ϒ",
  Upsilon: "Υ",
  Uring: "Ů",
  Uscr: "\uD835\uDCB0",
  Utilde: "Ũ",
  Uuml: "Ü",
  VDash: "⊫",
  Vbar: "⫫",
  Vcy: "В",
  Vdash: "⊩",
  Vdashl: "⫦",
  Vee: "⋁",
  Verbar: "‖",
  Vert: "‖",
  VerticalBar: "∣",
  VerticalLine: "|",
  VerticalSeparator: "❘",
  VerticalTilde: "≀",
  VeryThinSpace: " ",
  Vfr: "\uD835\uDD19",
  Vopf: "\uD835\uDD4D",
  Vscr: "\uD835\uDCB1",
  Vvdash: "⊪",
  Wcirc: "Ŵ",
  Wedge: "⋀",
  Wfr: "\uD835\uDD1A",
  Wopf: "\uD835\uDD4E",
  Wscr: "\uD835\uDCB2",
  Xfr: "\uD835\uDD1B",
  Xi: "Ξ",
  Xopf: "\uD835\uDD4F",
  Xscr: "\uD835\uDCB3",
  YAcy: "Я",
  YIcy: "Ї",
  YUcy: "Ю",
  Yacute: "Ý",
  Ycirc: "Ŷ",
  Ycy: "Ы",
  Yfr: "\uD835\uDD1C",
  Yopf: "\uD835\uDD50",
  Yscr: "\uD835\uDCB4",
  Yuml: "Ÿ",
  ZHcy: "Ж",
  Zacute: "Ź",
  Zcaron: "Ž",
  Zcy: "З",
  Zdot: "Ż",
  ZeroWidthSpace: "​",
  Zeta: "Ζ",
  Zfr: "ℨ",
  Zopf: "ℤ",
  Zscr: "\uD835\uDCB5",
  aacute: "á",
  abreve: "ă",
  ac: "∾",
  acE: "∾̳",
  acd: "∿",
  acirc: "â",
  acute: "´",
  acy: "а",
  aelig: "æ",
  af: "⁡",
  afr: "\uD835\uDD1E",
  agrave: "à",
  alefsym: "ℵ",
  aleph: "ℵ",
  alpha: "α",
  amacr: "ā",
  amalg: "⨿",
  amp: "&",
  and: "∧",
  andand: "⩕",
  andd: "⩜",
  andslope: "⩘",
  andv: "⩚",
  ang: "∠",
  ange: "⦤",
  angle: "∠",
  angmsd: "∡",
  angmsdaa: "⦨",
  angmsdab: "⦩",
  angmsdac: "⦪",
  angmsdad: "⦫",
  angmsdae: "⦬",
  angmsdaf: "⦭",
  angmsdag: "⦮",
  angmsdah: "⦯",
  angrt: "∟",
  angrtvb: "⊾",
  angrtvbd: "⦝",
  angsph: "∢",
  angst: "Å",
  angzarr: "⍼",
  aogon: "ą",
  aopf: "\uD835\uDD52",
  ap: "≈",
  apE: "⩰",
  apacir: "⩯",
  ape: "≊",
  apid: "≋",
  apos: "'",
  approx: "≈",
  approxeq: "≊",
  aring: "å",
  ascr: "\uD835\uDCB6",
  ast: "*",
  asymp: "≈",
  asympeq: "≍",
  atilde: "ã",
  auml: "ä",
  awconint: "∳",
  awint: "⨑",
  bNot: "⫭",
  backcong: "≌",
  backepsilon: "϶",
  backprime: "‵",
  backsim: "∽",
  backsimeq: "⋍",
  barvee: "⊽",
  barwed: "⌅",
  barwedge: "⌅",
  bbrk: "⎵",
  bbrktbrk: "⎶",
  bcong: "≌",
  bcy: "б",
  bdquo: "„",
  becaus: "∵",
  because: "∵",
  bemptyv: "⦰",
  bepsi: "϶",
  bernou: "ℬ",
  beta: "β",
  beth: "ℶ",
  between: "≬",
  bfr: "\uD835\uDD1F",
  bigcap: "⋂",
  bigcirc: "◯",
  bigcup: "⋃",
  bigodot: "⨀",
  bigoplus: "⨁",
  bigotimes: "⨂",
  bigsqcup: "⨆",
  bigstar: "★",
  bigtriangledown: "▽",
  bigtriangleup: "△",
  biguplus: "⨄",
  bigvee: "⋁",
  bigwedge: "⋀",
  bkarow: "⤍",
  blacklozenge: "⧫",
  blacksquare: "▪",
  blacktriangle: "▴",
  blacktriangledown: "▾",
  blacktriangleleft: "◂",
  blacktriangleright: "▸",
  blank: "␣",
  blk12: "▒",
  blk14: "░",
  blk34: "▓",
  block: "█",
  bne: "=⃥",
  bnequiv: "≡⃥",
  bnot: "⌐",
  bopf: "\uD835\uDD53",
  bot: "⊥",
  bottom: "⊥",
  bowtie: "⋈",
  boxDL: "╗",
  boxDR: "╔",
  boxDl: "╖",
  boxDr: "╓",
  boxH: "═",
  boxHD: "╦",
  boxHU: "╩",
  boxHd: "╤",
  boxHu: "╧",
  boxUL: "╝",
  boxUR: "╚",
  boxUl: "╜",
  boxUr: "╙",
  boxV: "║",
  boxVH: "╬",
  boxVL: "╣",
  boxVR: "╠",
  boxVh: "╫",
  boxVl: "╢",
  boxVr: "╟",
  boxbox: "⧉",
  boxdL: "╕",
  boxdR: "╒",
  boxdl: "┐",
  boxdr: "┌",
  boxh: "─",
  boxhD: "╥",
  boxhU: "╨",
  boxhd: "┬",
  boxhu: "┴",
  boxminus: "⊟",
  boxplus: "⊞",
  boxtimes: "⊠",
  boxuL: "╛",
  boxuR: "╘",
  boxul: "┘",
  boxur: "└",
  boxv: "│",
  boxvH: "╪",
  boxvL: "╡",
  boxvR: "╞",
  boxvh: "┼",
  boxvl: "┤",
  boxvr: "├",
  bprime: "‵",
  breve: "˘",
  brvbar: "¦",
  bscr: "\uD835\uDCB7",
  bsemi: "⁏",
  bsim: "∽",
  bsime: "⋍",
  bsol: "\\",
  bsolb: "⧅",
  bsolhsub: "⟈",
  bull: "•",
  bullet: "•",
  bump: "≎",
  bumpE: "⪮",
  bumpe: "≏",
  bumpeq: "≏",
  cacute: "ć",
  cap: "∩",
  capand: "⩄",
  capbrcup: "⩉",
  capcap: "⩋",
  capcup: "⩇",
  capdot: "⩀",
  caps: "∩︀",
  caret: "⁁",
  caron: "ˇ",
  ccaps: "⩍",
  ccaron: "č",
  ccedil: "ç",
  ccirc: "ĉ",
  ccups: "⩌",
  ccupssm: "⩐",
  cdot: "ċ",
  cedil: "¸",
  cemptyv: "⦲",
  cent: "¢",
  centerdot: "·",
  cfr: "\uD835\uDD20",
  chcy: "ч",
  check: "✓",
  checkmark: "✓",
  chi: "χ",
  cir: "○",
  cirE: "⧃",
  circ: "ˆ",
  circeq: "≗",
  circlearrowleft: "↺",
  circlearrowright: "↻",
  circledR: "®",
  circledS: "Ⓢ",
  circledast: "⊛",
  circledcirc: "⊚",
  circleddash: "⊝",
  cire: "≗",
  cirfnint: "⨐",
  cirmid: "⫯",
  cirscir: "⧂",
  clubs: "♣",
  clubsuit: "♣",
  colon: ":",
  colone: "≔",
  coloneq: "≔",
  comma: ",",
  commat: "@",
  comp: "∁",
  compfn: "∘",
  complement: "∁",
  complexes: "ℂ",
  cong: "≅",
  congdot: "⩭",
  conint: "∮",
  copf: "\uD835\uDD54",
  coprod: "∐",
  copy: "©",
  copysr: "℗",
  crarr: "↵",
  cross: "✗",
  cscr: "\uD835\uDCB8",
  csub: "⫏",
  csube: "⫑",
  csup: "⫐",
  csupe: "⫒",
  ctdot: "⋯",
  cudarrl: "⤸",
  cudarrr: "⤵",
  cuepr: "⋞",
  cuesc: "⋟",
  cularr: "↶",
  cularrp: "⤽",
  cup: "∪",
  cupbrcap: "⩈",
  cupcap: "⩆",
  cupcup: "⩊",
  cupdot: "⊍",
  cupor: "⩅",
  cups: "∪︀",
  curarr: "↷",
  curarrm: "⤼",
  curlyeqprec: "⋞",
  curlyeqsucc: "⋟",
  curlyvee: "⋎",
  curlywedge: "⋏",
  curren: "¤",
  curvearrowleft: "↶",
  curvearrowright: "↷",
  cuvee: "⋎",
  cuwed: "⋏",
  cwconint: "∲",
  cwint: "∱",
  cylcty: "⌭",
  dArr: "⇓",
  dHar: "⥥",
  dagger: "†",
  daleth: "ℸ",
  darr: "↓",
  dash: "‐",
  dashv: "⊣",
  dbkarow: "⤏",
  dblac: "˝",
  dcaron: "ď",
  dcy: "д",
  dd: "ⅆ",
  ddagger: "‡",
  ddarr: "⇊",
  ddotseq: "⩷",
  deg: "°",
  delta: "δ",
  demptyv: "⦱",
  dfisht: "⥿",
  dfr: "\uD835\uDD21",
  dharl: "⇃",
  dharr: "⇂",
  diam: "⋄",
  diamond: "⋄",
  diamondsuit: "♦",
  diams: "♦",
  die: "¨",
  digamma: "ϝ",
  disin: "⋲",
  div: "÷",
  divide: "÷",
  divideontimes: "⋇",
  divonx: "⋇",
  djcy: "ђ",
  dlcorn: "⌞",
  dlcrop: "⌍",
  dollar: "$",
  dopf: "\uD835\uDD55",
  dot: "˙",
  doteq: "≐",
  doteqdot: "≑",
  dotminus: "∸",
  dotplus: "∔",
  dotsquare: "⊡",
  doublebarwedge: "⌆",
  downarrow: "↓",
  downdownarrows: "⇊",
  downharpoonleft: "⇃",
  downharpoonright: "⇂",
  drbkarow: "⤐",
  drcorn: "⌟",
  drcrop: "⌌",
  dscr: "\uD835\uDCB9",
  dscy: "ѕ",
  dsol: "⧶",
  dstrok: "đ",
  dtdot: "⋱",
  dtri: "▿",
  dtrif: "▾",
  duarr: "⇵",
  duhar: "⥯",
  dwangle: "⦦",
  dzcy: "џ",
  dzigrarr: "⟿",
  eDDot: "⩷",
  eDot: "≑",
  eacute: "é",
  easter: "⩮",
  ecaron: "ě",
  ecir: "≖",
  ecirc: "ê",
  ecolon: "≕",
  ecy: "э",
  edot: "ė",
  ee: "ⅇ",
  efDot: "≒",
  efr: "\uD835\uDD22",
  eg: "⪚",
  egrave: "è",
  egs: "⪖",
  egsdot: "⪘",
  el: "⪙",
  elinters: "⏧",
  ell: "ℓ",
  els: "⪕",
  elsdot: "⪗",
  emacr: "ē",
  empty: "∅",
  emptyset: "∅",
  emptyv: "∅",
  emsp13: " ",
  emsp14: " ",
  emsp: " ",
  eng: "ŋ",
  ensp: " ",
  eogon: "ę",
  eopf: "\uD835\uDD56",
  epar: "⋕",
  eparsl: "⧣",
  eplus: "⩱",
  epsi: "ε",
  epsilon: "ε",
  epsiv: "ϵ",
  eqcirc: "≖",
  eqcolon: "≕",
  eqsim: "≂",
  eqslantgtr: "⪖",
  eqslantless: "⪕",
  equals: "=",
  equest: "≟",
  equiv: "≡",
  equivDD: "⩸",
  eqvparsl: "⧥",
  erDot: "≓",
  erarr: "⥱",
  escr: "ℯ",
  esdot: "≐",
  esim: "≂",
  eta: "η",
  eth: "ð",
  euml: "ë",
  euro: "€",
  excl: "!",
  exist: "∃",
  expectation: "ℰ",
  exponentiale: "ⅇ",
  fallingdotseq: "≒",
  fcy: "ф",
  female: "♀",
  ffilig: "ﬃ",
  fflig: "ﬀ",
  ffllig: "ﬄ",
  ffr: "\uD835\uDD23",
  filig: "ﬁ",
  fjlig: "fj",
  flat: "♭",
  fllig: "ﬂ",
  fltns: "▱",
  fnof: "ƒ",
  fopf: "\uD835\uDD57",
  forall: "∀",
  fork: "⋔",
  forkv: "⫙",
  fpartint: "⨍",
  frac12: "½",
  frac13: "⅓",
  frac14: "¼",
  frac15: "⅕",
  frac16: "⅙",
  frac18: "⅛",
  frac23: "⅔",
  frac25: "⅖",
  frac34: "¾",
  frac35: "⅗",
  frac38: "⅜",
  frac45: "⅘",
  frac56: "⅚",
  frac58: "⅝",
  frac78: "⅞",
  frasl: "⁄",
  frown: "⌢",
  fscr: "\uD835\uDCBB",
  gE: "≧",
  gEl: "⪌",
  gacute: "ǵ",
  gamma: "γ",
  gammad: "ϝ",
  gap: "⪆",
  gbreve: "ğ",
  gcirc: "ĝ",
  gcy: "г",
  gdot: "ġ",
  ge: "≥",
  gel: "⋛",
  geq: "≥",
  geqq: "≧",
  geqslant: "⩾",
  ges: "⩾",
  gescc: "⪩",
  gesdot: "⪀",
  gesdoto: "⪂",
  gesdotol: "⪄",
  gesl: "⋛︀",
  gesles: "⪔",
  gfr: "\uD835\uDD24",
  gg: "≫",
  ggg: "⋙",
  gimel: "ℷ",
  gjcy: "ѓ",
  gl: "≷",
  glE: "⪒",
  gla: "⪥",
  glj: "⪤",
  gnE: "≩",
  gnap: "⪊",
  gnapprox: "⪊",
  gne: "⪈",
  gneq: "⪈",
  gneqq: "≩",
  gnsim: "⋧",
  gopf: "\uD835\uDD58",
  grave: "`",
  gscr: "ℊ",
  gsim: "≳",
  gsime: "⪎",
  gsiml: "⪐",
  gt: ">",
  gtcc: "⪧",
  gtcir: "⩺",
  gtdot: "⋗",
  gtlPar: "⦕",
  gtquest: "⩼",
  gtrapprox: "⪆",
  gtrarr: "⥸",
  gtrdot: "⋗",
  gtreqless: "⋛",
  gtreqqless: "⪌",
  gtrless: "≷",
  gtrsim: "≳",
  gvertneqq: "≩︀",
  gvnE: "≩︀",
  hArr: "⇔",
  hairsp: " ",
  half: "½",
  hamilt: "ℋ",
  hardcy: "ъ",
  harr: "↔",
  harrcir: "⥈",
  harrw: "↭",
  hbar: "ℏ",
  hcirc: "ĥ",
  hearts: "♥",
  heartsuit: "♥",
  hellip: "…",
  hercon: "⊹",
  hfr: "\uD835\uDD25",
  hksearow: "⤥",
  hkswarow: "⤦",
  hoarr: "⇿",
  homtht: "∻",
  hookleftarrow: "↩",
  hookrightarrow: "↪",
  hopf: "\uD835\uDD59",
  horbar: "―",
  hscr: "\uD835\uDCBD",
  hslash: "ℏ",
  hstrok: "ħ",
  hybull: "⁃",
  hyphen: "‐",
  iacute: "í",
  ic: "⁣",
  icirc: "î",
  icy: "и",
  iecy: "е",
  iexcl: "¡",
  iff: "⇔",
  ifr: "\uD835\uDD26",
  igrave: "ì",
  ii: "ⅈ",
  iiiint: "⨌",
  iiint: "∭",
  iinfin: "⧜",
  iiota: "℩",
  ijlig: "ĳ",
  imacr: "ī",
  image: "ℑ",
  imagline: "ℐ",
  imagpart: "ℑ",
  imath: "ı",
  imof: "⊷",
  imped: "Ƶ",
  in: "∈",
  incare: "℅",
  infin: "∞",
  infintie: "⧝",
  inodot: "ı",
  int: "∫",
  intcal: "⊺",
  integers: "ℤ",
  intercal: "⊺",
  intlarhk: "⨗",
  intprod: "⨼",
  iocy: "ё",
  iogon: "į",
  iopf: "\uD835\uDD5A",
  iota: "ι",
  iprod: "⨼",
  iquest: "¿",
  iscr: "\uD835\uDCBE",
  isin: "∈",
  isinE: "⋹",
  isindot: "⋵",
  isins: "⋴",
  isinsv: "⋳",
  isinv: "∈",
  it: "⁢",
  itilde: "ĩ",
  iukcy: "і",
  iuml: "ï",
  jcirc: "ĵ",
  jcy: "й",
  jfr: "\uD835\uDD27",
  jmath: "ȷ",
  jopf: "\uD835\uDD5B",
  jscr: "\uD835\uDCBF",
  jsercy: "ј",
  jukcy: "є",
  kappa: "κ",
  kappav: "ϰ",
  kcedil: "ķ",
  kcy: "к",
  kfr: "\uD835\uDD28",
  kgreen: "ĸ",
  khcy: "х",
  kjcy: "ќ",
  kopf: "\uD835\uDD5C",
  kscr: "\uD835\uDCC0",
  lAarr: "⇚",
  lArr: "⇐",
  lAtail: "⤛",
  lBarr: "⤎",
  lE: "≦",
  lEg: "⪋",
  lHar: "⥢",
  lacute: "ĺ",
  laemptyv: "⦴",
  lagran: "ℒ",
  lambda: "λ",
  lang: "⟨",
  langd: "⦑",
  langle: "⟨",
  lap: "⪅",
  laquo: "«",
  larr: "←",
  larrb: "⇤",
  larrbfs: "⤟",
  larrfs: "⤝",
  larrhk: "↩",
  larrlp: "↫",
  larrpl: "⤹",
  larrsim: "⥳",
  larrtl: "↢",
  lat: "⪫",
  latail: "⤙",
  late: "⪭",
  lates: "⪭︀",
  lbarr: "⤌",
  lbbrk: "❲",
  lbrace: "{",
  lbrack: "[",
  lbrke: "⦋",
  lbrksld: "⦏",
  lbrkslu: "⦍",
  lcaron: "ľ",
  lcedil: "ļ",
  lceil: "⌈",
  lcub: "{",
  lcy: "л",
  ldca: "⤶",
  ldquo: "“",
  ldquor: "„",
  ldrdhar: "⥧",
  ldrushar: "⥋",
  ldsh: "↲",
  le: "≤",
  leftarrow: "←",
  leftarrowtail: "↢",
  leftharpoondown: "↽",
  leftharpoonup: "↼",
  leftleftarrows: "⇇",
  leftrightarrow: "↔",
  leftrightarrows: "⇆",
  leftrightharpoons: "⇋",
  leftrightsquigarrow: "↭",
  leftthreetimes: "⋋",
  leg: "⋚",
  leq: "≤",
  leqq: "≦",
  leqslant: "⩽",
  les: "⩽",
  lescc: "⪨",
  lesdot: "⩿",
  lesdoto: "⪁",
  lesdotor: "⪃",
  lesg: "⋚︀",
  lesges: "⪓",
  lessapprox: "⪅",
  lessdot: "⋖",
  lesseqgtr: "⋚",
  lesseqqgtr: "⪋",
  lessgtr: "≶",
  lesssim: "≲",
  lfisht: "⥼",
  lfloor: "⌊",
  lfr: "\uD835\uDD29",
  lg: "≶",
  lgE: "⪑",
  lhard: "↽",
  lharu: "↼",
  lharul: "⥪",
  lhblk: "▄",
  ljcy: "љ",
  ll: "≪",
  llarr: "⇇",
  llcorner: "⌞",
  llhard: "⥫",
  lltri: "◺",
  lmidot: "ŀ",
  lmoust: "⎰",
  lmoustache: "⎰",
  lnE: "≨",
  lnap: "⪉",
  lnapprox: "⪉",
  lne: "⪇",
  lneq: "⪇",
  lneqq: "≨",
  lnsim: "⋦",
  loang: "⟬",
  loarr: "⇽",
  lobrk: "⟦",
  longleftarrow: "⟵",
  longleftrightarrow: "⟷",
  longmapsto: "⟼",
  longrightarrow: "⟶",
  looparrowleft: "↫",
  looparrowright: "↬",
  lopar: "⦅",
  lopf: "\uD835\uDD5D",
  loplus: "⨭",
  lotimes: "⨴",
  lowast: "∗",
  lowbar: "_",
  loz: "◊",
  lozenge: "◊",
  lozf: "⧫",
  lpar: "(",
  lparlt: "⦓",
  lrarr: "⇆",
  lrcorner: "⌟",
  lrhar: "⇋",
  lrhard: "⥭",
  lrm: "‎",
  lrtri: "⊿",
  lsaquo: "‹",
  lscr: "\uD835\uDCC1",
  lsh: "↰",
  lsim: "≲",
  lsime: "⪍",
  lsimg: "⪏",
  lsqb: "[",
  lsquo: "‘",
  lsquor: "‚",
  lstrok: "ł",
  lt: "<",
  ltcc: "⪦",
  ltcir: "⩹",
  ltdot: "⋖",
  lthree: "⋋",
  ltimes: "⋉",
  ltlarr: "⥶",
  ltquest: "⩻",
  ltrPar: "⦖",
  ltri: "◃",
  ltrie: "⊴",
  ltrif: "◂",
  lurdshar: "⥊",
  luruhar: "⥦",
  lvertneqq: "≨︀",
  lvnE: "≨︀",
  mDDot: "∺",
  macr: "¯",
  male: "♂",
  malt: "✠",
  maltese: "✠",
  map: "↦",
  mapsto: "↦",
  mapstodown: "↧",
  mapstoleft: "↤",
  mapstoup: "↥",
  marker: "▮",
  mcomma: "⨩",
  mcy: "м",
  mdash: "—",
  measuredangle: "∡",
  mfr: "\uD835\uDD2A",
  mho: "℧",
  micro: "µ",
  mid: "∣",
  midast: "*",
  midcir: "⫰",
  middot: "·",
  minus: "−",
  minusb: "⊟",
  minusd: "∸",
  minusdu: "⨪",
  mlcp: "⫛",
  mldr: "…",
  mnplus: "∓",
  models: "⊧",
  mopf: "\uD835\uDD5E",
  mp: "∓",
  mscr: "\uD835\uDCC2",
  mstpos: "∾",
  mu: "μ",
  multimap: "⊸",
  mumap: "⊸",
  nGg: "⋙̸",
  nGt: "≫⃒",
  nGtv: "≫̸",
  nLeftarrow: "⇍",
  nLeftrightarrow: "⇎",
  nLl: "⋘̸",
  nLt: "≪⃒",
  nLtv: "≪̸",
  nRightarrow: "⇏",
  nVDash: "⊯",
  nVdash: "⊮",
  nabla: "∇",
  nacute: "ń",
  nang: "∠⃒",
  nap: "≉",
  napE: "⩰̸",
  napid: "≋̸",
  napos: "ŉ",
  napprox: "≉",
  natur: "♮",
  natural: "♮",
  naturals: "ℕ",
  nbsp: " ",
  nbump: "≎̸",
  nbumpe: "≏̸",
  ncap: "⩃",
  ncaron: "ň",
  ncedil: "ņ",
  ncong: "≇",
  ncongdot: "⩭̸",
  ncup: "⩂",
  ncy: "н",
  ndash: "–",
  ne: "≠",
  neArr: "⇗",
  nearhk: "⤤",
  nearr: "↗",
  nearrow: "↗",
  nedot: "≐̸",
  nequiv: "≢",
  nesear: "⤨",
  nesim: "≂̸",
  nexist: "∄",
  nexists: "∄",
  nfr: "\uD835\uDD2B",
  ngE: "≧̸",
  nge: "≱",
  ngeq: "≱",
  ngeqq: "≧̸",
  ngeqslant: "⩾̸",
  nges: "⩾̸",
  ngsim: "≵",
  ngt: "≯",
  ngtr: "≯",
  nhArr: "⇎",
  nharr: "↮",
  nhpar: "⫲",
  ni: "∋",
  nis: "⋼",
  nisd: "⋺",
  niv: "∋",
  njcy: "њ",
  nlArr: "⇍",
  nlE: "≦̸",
  nlarr: "↚",
  nldr: "‥",
  nle: "≰",
  nleftarrow: "↚",
  nleftrightarrow: "↮",
  nleq: "≰",
  nleqq: "≦̸",
  nleqslant: "⩽̸",
  nles: "⩽̸",
  nless: "≮",
  nlsim: "≴",
  nlt: "≮",
  nltri: "⋪",
  nltrie: "⋬",
  nmid: "∤",
  nopf: "\uD835\uDD5F",
  not: "¬",
  notin: "∉",
  notinE: "⋹̸",
  notindot: "⋵̸",
  notinva: "∉",
  notinvb: "⋷",
  notinvc: "⋶",
  notni: "∌",
  notniva: "∌",
  notnivb: "⋾",
  notnivc: "⋽",
  npar: "∦",
  nparallel: "∦",
  nparsl: "⫽⃥",
  npart: "∂̸",
  npolint: "⨔",
  npr: "⊀",
  nprcue: "⋠",
  npre: "⪯̸",
  nprec: "⊀",
  npreceq: "⪯̸",
  nrArr: "⇏",
  nrarr: "↛",
  nrarrc: "⤳̸",
  nrarrw: "↝̸",
  nrightarrow: "↛",
  nrtri: "⋫",
  nrtrie: "⋭",
  nsc: "⊁",
  nsccue: "⋡",
  nsce: "⪰̸",
  nscr: "\uD835\uDCC3",
  nshortmid: "∤",
  nshortparallel: "∦",
  nsim: "≁",
  nsime: "≄",
  nsimeq: "≄",
  nsmid: "∤",
  nspar: "∦",
  nsqsube: "⋢",
  nsqsupe: "⋣",
  nsub: "⊄",
  nsubE: "⫅̸",
  nsube: "⊈",
  nsubset: "⊂⃒",
  nsubseteq: "⊈",
  nsubseteqq: "⫅̸",
  nsucc: "⊁",
  nsucceq: "⪰̸",
  nsup: "⊅",
  nsupE: "⫆̸",
  nsupe: "⊉",
  nsupset: "⊃⃒",
  nsupseteq: "⊉",
  nsupseteqq: "⫆̸",
  ntgl: "≹",
  ntilde: "ñ",
  ntlg: "≸",
  ntriangleleft: "⋪",
  ntrianglelefteq: "⋬",
  ntriangleright: "⋫",
  ntrianglerighteq: "⋭",
  nu: "ν",
  num: "#",
  numero: "№",
  numsp: " ",
  nvDash: "⊭",
  nvHarr: "⤄",
  nvap: "≍⃒",
  nvdash: "⊬",
  nvge: "≥⃒",
  nvgt: ">⃒",
  nvinfin: "⧞",
  nvlArr: "⤂",
  nvle: "≤⃒",
  nvlt: "<⃒",
  nvltrie: "⊴⃒",
  nvrArr: "⤃",
  nvrtrie: "⊵⃒",
  nvsim: "∼⃒",
  nwArr: "⇖",
  nwarhk: "⤣",
  nwarr: "↖",
  nwarrow: "↖",
  nwnear: "⤧",
  oS: "Ⓢ",
  oacute: "ó",
  oast: "⊛",
  ocir: "⊚",
  ocirc: "ô",
  ocy: "о",
  odash: "⊝",
  odblac: "ő",
  odiv: "⨸",
  odot: "⊙",
  odsold: "⦼",
  oelig: "œ",
  ofcir: "⦿",
  ofr: "\uD835\uDD2C",
  ogon: "˛",
  ograve: "ò",
  ogt: "⧁",
  ohbar: "⦵",
  ohm: "Ω",
  oint: "∮",
  olarr: "↺",
  olcir: "⦾",
  olcross: "⦻",
  oline: "‾",
  olt: "⧀",
  omacr: "ō",
  omega: "ω",
  omicron: "ο",
  omid: "⦶",
  ominus: "⊖",
  oopf: "\uD835\uDD60",
  opar: "⦷",
  operp: "⦹",
  oplus: "⊕",
  or: "∨",
  orarr: "↻",
  ord: "⩝",
  order: "ℴ",
  orderof: "ℴ",
  ordf: "ª",
  ordm: "º",
  origof: "⊶",
  oror: "⩖",
  orslope: "⩗",
  orv: "⩛",
  oscr: "ℴ",
  oslash: "ø",
  osol: "⊘",
  otilde: "õ",
  otimes: "⊗",
  otimesas: "⨶",
  ouml: "ö",
  ovbar: "⌽",
  par: "∥",
  para: "¶",
  parallel: "∥",
  parsim: "⫳",
  parsl: "⫽",
  part: "∂",
  pcy: "п",
  percnt: "%",
  period: ".",
  permil: "‰",
  perp: "⊥",
  pertenk: "‱",
  pfr: "\uD835\uDD2D",
  phi: "φ",
  phiv: "ϕ",
  phmmat: "ℳ",
  phone: "☎",
  pi: "π",
  pitchfork: "⋔",
  piv: "ϖ",
  planck: "ℏ",
  planckh: "ℎ",
  plankv: "ℏ",
  plus: "+",
  plusacir: "⨣",
  plusb: "⊞",
  pluscir: "⨢",
  plusdo: "∔",
  plusdu: "⨥",
  pluse: "⩲",
  plusmn: "±",
  plussim: "⨦",
  plustwo: "⨧",
  pm: "±",
  pointint: "⨕",
  popf: "\uD835\uDD61",
  pound: "£",
  pr: "≺",
  prE: "⪳",
  prap: "⪷",
  prcue: "≼",
  pre: "⪯",
  prec: "≺",
  precapprox: "⪷",
  preccurlyeq: "≼",
  preceq: "⪯",
  precnapprox: "⪹",
  precneqq: "⪵",
  precnsim: "⋨",
  precsim: "≾",
  prime: "′",
  primes: "ℙ",
  prnE: "⪵",
  prnap: "⪹",
  prnsim: "⋨",
  prod: "∏",
  profalar: "⌮",
  profline: "⌒",
  profsurf: "⌓",
  prop: "∝",
  propto: "∝",
  prsim: "≾",
  prurel: "⊰",
  pscr: "\uD835\uDCC5",
  psi: "ψ",
  puncsp: " ",
  qfr: "\uD835\uDD2E",
  qint: "⨌",
  qopf: "\uD835\uDD62",
  qprime: "⁗",
  qscr: "\uD835\uDCC6",
  quaternions: "ℍ",
  quatint: "⨖",
  quest: "?",
  questeq: "≟",
  quot: '"',
  rAarr: "⇛",
  rArr: "⇒",
  rAtail: "⤜",
  rBarr: "⤏",
  rHar: "⥤",
  race: "∽̱",
  racute: "ŕ",
  radic: "√",
  raemptyv: "⦳",
  rang: "⟩",
  rangd: "⦒",
  range: "⦥",
  rangle: "⟩",
  raquo: "»",
  rarr: "→",
  rarrap: "⥵",
  rarrb: "⇥",
  rarrbfs: "⤠",
  rarrc: "⤳",
  rarrfs: "⤞",
  rarrhk: "↪",
  rarrlp: "↬",
  rarrpl: "⥅",
  rarrsim: "⥴",
  rarrtl: "↣",
  rarrw: "↝",
  ratail: "⤚",
  ratio: "∶",
  rationals: "ℚ",
  rbarr: "⤍",
  rbbrk: "❳",
  rbrace: "}",
  rbrack: "]",
  rbrke: "⦌",
  rbrksld: "⦎",
  rbrkslu: "⦐",
  rcaron: "ř",
  rcedil: "ŗ",
  rceil: "⌉",
  rcub: "}",
  rcy: "р",
  rdca: "⤷",
  rdldhar: "⥩",
  rdquo: "”",
  rdquor: "”",
  rdsh: "↳",
  real: "ℜ",
  realine: "ℛ",
  realpart: "ℜ",
  reals: "ℝ",
  rect: "▭",
  reg: "®",
  rfisht: "⥽",
  rfloor: "⌋",
  rfr: "\uD835\uDD2F",
  rhard: "⇁",
  rharu: "⇀",
  rharul: "⥬",
  rho: "ρ",
  rhov: "ϱ",
  rightarrow: "→",
  rightarrowtail: "↣",
  rightharpoondown: "⇁",
  rightharpoonup: "⇀",
  rightleftarrows: "⇄",
  rightleftharpoons: "⇌",
  rightrightarrows: "⇉",
  rightsquigarrow: "↝",
  rightthreetimes: "⋌",
  ring: "˚",
  risingdotseq: "≓",
  rlarr: "⇄",
  rlhar: "⇌",
  rlm: "‏",
  rmoust: "⎱",
  rmoustache: "⎱",
  rnmid: "⫮",
  roang: "⟭",
  roarr: "⇾",
  robrk: "⟧",
  ropar: "⦆",
  ropf: "\uD835\uDD63",
  roplus: "⨮",
  rotimes: "⨵",
  rpar: ")",
  rpargt: "⦔",
  rppolint: "⨒",
  rrarr: "⇉",
  rsaquo: "›",
  rscr: "\uD835\uDCC7",
  rsh: "↱",
  rsqb: "]",
  rsquo: "’",
  rsquor: "’",
  rthree: "⋌",
  rtimes: "⋊",
  rtri: "▹",
  rtrie: "⊵",
  rtrif: "▸",
  rtriltri: "⧎",
  ruluhar: "⥨",
  rx: "℞",
  sacute: "ś",
  sbquo: "‚",
  sc: "≻",
  scE: "⪴",
  scap: "⪸",
  scaron: "š",
  sccue: "≽",
  sce: "⪰",
  scedil: "ş",
  scirc: "ŝ",
  scnE: "⪶",
  scnap: "⪺",
  scnsim: "⋩",
  scpolint: "⨓",
  scsim: "≿",
  scy: "с",
  sdot: "⋅",
  sdotb: "⊡",
  sdote: "⩦",
  seArr: "⇘",
  searhk: "⤥",
  searr: "↘",
  searrow: "↘",
  sect: "§",
  semi: ";",
  seswar: "⤩",
  setminus: "∖",
  setmn: "∖",
  sext: "✶",
  sfr: "\uD835\uDD30",
  sfrown: "⌢",
  sharp: "♯",
  shchcy: "щ",
  shcy: "ш",
  shortmid: "∣",
  shortparallel: "∥",
  shy: "­",
  sigma: "σ",
  sigmaf: "ς",
  sigmav: "ς",
  sim: "∼",
  simdot: "⩪",
  sime: "≃",
  simeq: "≃",
  simg: "⪞",
  simgE: "⪠",
  siml: "⪝",
  simlE: "⪟",
  simne: "≆",
  simplus: "⨤",
  simrarr: "⥲",
  slarr: "←",
  smallsetminus: "∖",
  smashp: "⨳",
  smeparsl: "⧤",
  smid: "∣",
  smile: "⌣",
  smt: "⪪",
  smte: "⪬",
  smtes: "⪬︀",
  softcy: "ь",
  sol: "/",
  solb: "⧄",
  solbar: "⌿",
  sopf: "\uD835\uDD64",
  spades: "♠",
  spadesuit: "♠",
  spar: "∥",
  sqcap: "⊓",
  sqcaps: "⊓︀",
  sqcup: "⊔",
  sqcups: "⊔︀",
  sqsub: "⊏",
  sqsube: "⊑",
  sqsubset: "⊏",
  sqsubseteq: "⊑",
  sqsup: "⊐",
  sqsupe: "⊒",
  sqsupset: "⊐",
  sqsupseteq: "⊒",
  squ: "□",
  square: "□",
  squarf: "▪",
  squf: "▪",
  srarr: "→",
  sscr: "\uD835\uDCC8",
  ssetmn: "∖",
  ssmile: "⌣",
  sstarf: "⋆",
  star: "☆",
  starf: "★",
  straightepsilon: "ϵ",
  straightphi: "ϕ",
  strns: "¯",
  sub: "⊂",
  subE: "⫅",
  subdot: "⪽",
  sube: "⊆",
  subedot: "⫃",
  submult: "⫁",
  subnE: "⫋",
  subne: "⊊",
  subplus: "⪿",
  subrarr: "⥹",
  subset: "⊂",
  subseteq: "⊆",
  subseteqq: "⫅",
  subsetneq: "⊊",
  subsetneqq: "⫋",
  subsim: "⫇",
  subsub: "⫕",
  subsup: "⫓",
  succ: "≻",
  succapprox: "⪸",
  succcurlyeq: "≽",
  succeq: "⪰",
  succnapprox: "⪺",
  succneqq: "⪶",
  succnsim: "⋩",
  succsim: "≿",
  sum: "∑",
  sung: "♪",
  sup1: "¹",
  sup2: "²",
  sup3: "³",
  sup: "⊃",
  supE: "⫆",
  supdot: "⪾",
  supdsub: "⫘",
  supe: "⊇",
  supedot: "⫄",
  suphsol: "⟉",
  suphsub: "⫗",
  suplarr: "⥻",
  supmult: "⫂",
  supnE: "⫌",
  supne: "⊋",
  supplus: "⫀",
  supset: "⊃",
  supseteq: "⊇",
  supseteqq: "⫆",
  supsetneq: "⊋",
  supsetneqq: "⫌",
  supsim: "⫈",
  supsub: "⫔",
  supsup: "⫖",
  swArr: "⇙",
  swarhk: "⤦",
  swarr: "↙",
  swarrow: "↙",
  swnwar: "⤪",
  szlig: "ß",
  target: "⌖",
  tau: "τ",
  tbrk: "⎴",
  tcaron: "ť",
  tcedil: "ţ",
  tcy: "т",
  tdot: "⃛",
  telrec: "⌕",
  tfr: "\uD835\uDD31",
  there4: "∴",
  therefore: "∴",
  theta: "θ",
  thetasym: "ϑ",
  thetav: "ϑ",
  thickapprox: "≈",
  thicksim: "∼",
  thinsp: " ",
  thkap: "≈",
  thksim: "∼",
  thorn: "þ",
  tilde: "˜",
  times: "×",
  timesb: "⊠",
  timesbar: "⨱",
  timesd: "⨰",
  tint: "∭",
  toea: "⤨",
  top: "⊤",
  topbot: "⌶",
  topcir: "⫱",
  topf: "\uD835\uDD65",
  topfork: "⫚",
  tosa: "⤩",
  tprime: "‴",
  trade: "™",
  triangle: "▵",
  triangledown: "▿",
  triangleleft: "◃",
  trianglelefteq: "⊴",
  triangleq: "≜",
  triangleright: "▹",
  trianglerighteq: "⊵",
  tridot: "◬",
  trie: "≜",
  triminus: "⨺",
  triplus: "⨹",
  trisb: "⧍",
  tritime: "⨻",
  trpezium: "⏢",
  tscr: "\uD835\uDCC9",
  tscy: "ц",
  tshcy: "ћ",
  tstrok: "ŧ",
  twixt: "≬",
  twoheadleftarrow: "↞",
  twoheadrightarrow: "↠",
  uArr: "⇑",
  uHar: "⥣",
  uacute: "ú",
  uarr: "↑",
  ubrcy: "ў",
  ubreve: "ŭ",
  ucirc: "û",
  ucy: "у",
  udarr: "⇅",
  udblac: "ű",
  udhar: "⥮",
  ufisht: "⥾",
  ufr: "\uD835\uDD32",
  ugrave: "ù",
  uharl: "↿",
  uharr: "↾",
  uhblk: "▀",
  ulcorn: "⌜",
  ulcorner: "⌜",
  ulcrop: "⌏",
  ultri: "◸",
  umacr: "ū",
  uml: "¨",
  uogon: "ų",
  uopf: "\uD835\uDD66",
  uparrow: "↑",
  updownarrow: "↕",
  upharpoonleft: "↿",
  upharpoonright: "↾",
  uplus: "⊎",
  upsi: "υ",
  upsih: "ϒ",
  upsilon: "υ",
  upuparrows: "⇈",
  urcorn: "⌝",
  urcorner: "⌝",
  urcrop: "⌎",
  uring: "ů",
  urtri: "◹",
  uscr: "\uD835\uDCCA",
  utdot: "⋰",
  utilde: "ũ",
  utri: "▵",
  utrif: "▴",
  uuarr: "⇈",
  uuml: "ü",
  uwangle: "⦧",
  vArr: "⇕",
  vBar: "⫨",
  vBarv: "⫩",
  vDash: "⊨",
  vangrt: "⦜",
  varepsilon: "ϵ",
  varkappa: "ϰ",
  varnothing: "∅",
  varphi: "ϕ",
  varpi: "ϖ",
  varpropto: "∝",
  varr: "↕",
  varrho: "ϱ",
  varsigma: "ς",
  varsubsetneq: "⊊︀",
  varsubsetneqq: "⫋︀",
  varsupsetneq: "⊋︀",
  varsupsetneqq: "⫌︀",
  vartheta: "ϑ",
  vartriangleleft: "⊲",
  vartriangleright: "⊳",
  vcy: "в",
  vdash: "⊢",
  vee: "∨",
  veebar: "⊻",
  veeeq: "≚",
  vellip: "⋮",
  verbar: "|",
  vert: "|",
  vfr: "\uD835\uDD33",
  vltri: "⊲",
  vnsub: "⊂⃒",
  vnsup: "⊃⃒",
  vopf: "\uD835\uDD67",
  vprop: "∝",
  vrtri: "⊳",
  vscr: "\uD835\uDCCB",
  vsubnE: "⫋︀",
  vsubne: "⊊︀",
  vsupnE: "⫌︀",
  vsupne: "⊋︀",
  vzigzag: "⦚",
  wcirc: "ŵ",
  wedbar: "⩟",
  wedge: "∧",
  wedgeq: "≙",
  weierp: "℘",
  wfr: "\uD835\uDD34",
  wopf: "\uD835\uDD68",
  wp: "℘",
  wr: "≀",
  wreath: "≀",
  wscr: "\uD835\uDCCC",
  xcap: "⋂",
  xcirc: "◯",
  xcup: "⋃",
  xdtri: "▽",
  xfr: "\uD835\uDD35",
  xhArr: "⟺",
  xharr: "⟷",
  xi: "ξ",
  xlArr: "⟸",
  xlarr: "⟵",
  xmap: "⟼",
  xnis: "⋻",
  xodot: "⨀",
  xopf: "\uD835\uDD69",
  xoplus: "⨁",
  xotime: "⨂",
  xrArr: "⟹",
  xrarr: "⟶",
  xscr: "\uD835\uDCCD",
  xsqcup: "⨆",
  xuplus: "⨄",
  xutri: "△",
  xvee: "⋁",
  xwedge: "⋀",
  yacute: "ý",
  yacy: "я",
  ycirc: "ŷ",
  ycy: "ы",
  yen: "¥",
  yfr: "\uD835\uDD36",
  yicy: "ї",
  yopf: "\uD835\uDD6A",
  yscr: "\uD835\uDCCE",
  yucy: "ю",
  yuml: "ÿ",
  zacute: "ź",
  zcaron: "ž",
  zcy: "з",
  zdot: "ż",
  zeetrf: "ℨ",
  zeta: "ζ",
  zfr: "\uD835\uDD37",
  zhcy: "ж",
  zigrarr: "⇝",
  zopf: "\uD835\uDD6B",
  zscr: "\uD835\uDCCF",
  zwj: "‍",
  zwnj: "‌"
};

// node_modules/decode-named-character-reference/index.js
var own = {}.hasOwnProperty;
function decodeNamedCharacterReference(value) {
  return own.call(characterEntities, value) ? characterEntities[value] : false;
}

// node_modules/micromark-util-symbol/lib/codes.js
var codes = {
  carriageReturn: -5,
  lineFeed: -4,
  carriageReturnLineFeed: -3,
  horizontalTab: -2,
  virtualSpace: -1,
  eof: null,
  nul: 0,
  soh: 1,
  stx: 2,
  etx: 3,
  eot: 4,
  enq: 5,
  ack: 6,
  bel: 7,
  bs: 8,
  ht: 9,
  lf: 10,
  vt: 11,
  ff: 12,
  cr: 13,
  so: 14,
  si: 15,
  dle: 16,
  dc1: 17,
  dc2: 18,
  dc3: 19,
  dc4: 20,
  nak: 21,
  syn: 22,
  etb: 23,
  can: 24,
  em: 25,
  sub: 26,
  esc: 27,
  fs: 28,
  gs: 29,
  rs: 30,
  us: 31,
  space: 32,
  exclamationMark: 33,
  quotationMark: 34,
  numberSign: 35,
  dollarSign: 36,
  percentSign: 37,
  ampersand: 38,
  apostrophe: 39,
  leftParenthesis: 40,
  rightParenthesis: 41,
  asterisk: 42,
  plusSign: 43,
  comma: 44,
  dash: 45,
  dot: 46,
  slash: 47,
  digit0: 48,
  digit1: 49,
  digit2: 50,
  digit3: 51,
  digit4: 52,
  digit5: 53,
  digit6: 54,
  digit7: 55,
  digit8: 56,
  digit9: 57,
  colon: 58,
  semicolon: 59,
  lessThan: 60,
  equalsTo: 61,
  greaterThan: 62,
  questionMark: 63,
  atSign: 64,
  uppercaseA: 65,
  uppercaseB: 66,
  uppercaseC: 67,
  uppercaseD: 68,
  uppercaseE: 69,
  uppercaseF: 70,
  uppercaseG: 71,
  uppercaseH: 72,
  uppercaseI: 73,
  uppercaseJ: 74,
  uppercaseK: 75,
  uppercaseL: 76,
  uppercaseM: 77,
  uppercaseN: 78,
  uppercaseO: 79,
  uppercaseP: 80,
  uppercaseQ: 81,
  uppercaseR: 82,
  uppercaseS: 83,
  uppercaseT: 84,
  uppercaseU: 85,
  uppercaseV: 86,
  uppercaseW: 87,
  uppercaseX: 88,
  uppercaseY: 89,
  uppercaseZ: 90,
  leftSquareBracket: 91,
  backslash: 92,
  rightSquareBracket: 93,
  caret: 94,
  underscore: 95,
  graveAccent: 96,
  lowercaseA: 97,
  lowercaseB: 98,
  lowercaseC: 99,
  lowercaseD: 100,
  lowercaseE: 101,
  lowercaseF: 102,
  lowercaseG: 103,
  lowercaseH: 104,
  lowercaseI: 105,
  lowercaseJ: 106,
  lowercaseK: 107,
  lowercaseL: 108,
  lowercaseM: 109,
  lowercaseN: 110,
  lowercaseO: 111,
  lowercaseP: 112,
  lowercaseQ: 113,
  lowercaseR: 114,
  lowercaseS: 115,
  lowercaseT: 116,
  lowercaseU: 117,
  lowercaseV: 118,
  lowercaseW: 119,
  lowercaseX: 120,
  lowercaseY: 121,
  lowercaseZ: 122,
  leftCurlyBrace: 123,
  verticalBar: 124,
  rightCurlyBrace: 125,
  tilde: 126,
  del: 127,
  byteOrderMarker: 65279,
  replacementCharacter: 65533
};
// node_modules/micromark-util-symbol/lib/constants.js
var constants = {
  attentionSideAfter: 2,
  attentionSideBefore: 1,
  atxHeadingOpeningFenceSizeMax: 6,
  autolinkDomainSizeMax: 63,
  autolinkSchemeSizeMax: 32,
  cdataOpeningString: "CDATA[",
  characterGroupPunctuation: 2,
  characterGroupWhitespace: 1,
  characterReferenceDecimalSizeMax: 7,
  characterReferenceHexadecimalSizeMax: 6,
  characterReferenceNamedSizeMax: 31,
  codeFencedSequenceSizeMin: 3,
  contentTypeContent: "content",
  contentTypeDocument: "document",
  contentTypeFlow: "flow",
  contentTypeString: "string",
  contentTypeText: "text",
  hardBreakPrefixSizeMin: 2,
  htmlBasic: 6,
  htmlCdata: 5,
  htmlComment: 2,
  htmlComplete: 7,
  htmlDeclaration: 4,
  htmlInstruction: 3,
  htmlRawSizeMax: 8,
  htmlRaw: 1,
  linkResourceDestinationBalanceMax: 32,
  linkReferenceSizeMax: 999,
  listItemValueSizeMax: 10,
  numericBaseDecimal: 10,
  numericBaseHexadecimal: 16,
  tabSize: 4,
  thematicBreakMarkerCountMin: 3,
  v8MaxSafeChunkSize: 1e4
};
// node_modules/micromark-util-symbol/lib/types.js
var types = {
  data: "data",
  whitespace: "whitespace",
  lineEnding: "lineEnding",
  lineEndingBlank: "lineEndingBlank",
  linePrefix: "linePrefix",
  lineSuffix: "lineSuffix",
  atxHeading: "atxHeading",
  atxHeadingSequence: "atxHeadingSequence",
  atxHeadingText: "atxHeadingText",
  autolink: "autolink",
  autolinkEmail: "autolinkEmail",
  autolinkMarker: "autolinkMarker",
  autolinkProtocol: "autolinkProtocol",
  characterEscape: "characterEscape",
  characterEscapeValue: "characterEscapeValue",
  characterReference: "characterReference",
  characterReferenceMarker: "characterReferenceMarker",
  characterReferenceMarkerNumeric: "characterReferenceMarkerNumeric",
  characterReferenceMarkerHexadecimal: "characterReferenceMarkerHexadecimal",
  characterReferenceValue: "characterReferenceValue",
  codeFenced: "codeFenced",
  codeFencedFence: "codeFencedFence",
  codeFencedFenceSequence: "codeFencedFenceSequence",
  codeFencedFenceInfo: "codeFencedFenceInfo",
  codeFencedFenceMeta: "codeFencedFenceMeta",
  codeFlowValue: "codeFlowValue",
  codeIndented: "codeIndented",
  codeText: "codeText",
  codeTextData: "codeTextData",
  codeTextPadding: "codeTextPadding",
  codeTextSequence: "codeTextSequence",
  content: "content",
  definition: "definition",
  definitionDestination: "definitionDestination",
  definitionDestinationLiteral: "definitionDestinationLiteral",
  definitionDestinationLiteralMarker: "definitionDestinationLiteralMarker",
  definitionDestinationRaw: "definitionDestinationRaw",
  definitionDestinationString: "definitionDestinationString",
  definitionLabel: "definitionLabel",
  definitionLabelMarker: "definitionLabelMarker",
  definitionLabelString: "definitionLabelString",
  definitionMarker: "definitionMarker",
  definitionTitle: "definitionTitle",
  definitionTitleMarker: "definitionTitleMarker",
  definitionTitleString: "definitionTitleString",
  emphasis: "emphasis",
  emphasisSequence: "emphasisSequence",
  emphasisText: "emphasisText",
  escapeMarker: "escapeMarker",
  hardBreakEscape: "hardBreakEscape",
  hardBreakTrailing: "hardBreakTrailing",
  htmlFlow: "htmlFlow",
  htmlFlowData: "htmlFlowData",
  htmlText: "htmlText",
  htmlTextData: "htmlTextData",
  image: "image",
  label: "label",
  labelText: "labelText",
  labelLink: "labelLink",
  labelImage: "labelImage",
  labelMarker: "labelMarker",
  labelImageMarker: "labelImageMarker",
  labelEnd: "labelEnd",
  link: "link",
  paragraph: "paragraph",
  reference: "reference",
  referenceMarker: "referenceMarker",
  referenceString: "referenceString",
  resource: "resource",
  resourceDestination: "resourceDestination",
  resourceDestinationLiteral: "resourceDestinationLiteral",
  resourceDestinationLiteralMarker: "resourceDestinationLiteralMarker",
  resourceDestinationRaw: "resourceDestinationRaw",
  resourceDestinationString: "resourceDestinationString",
  resourceMarker: "resourceMarker",
  resourceTitle: "resourceTitle",
  resourceTitleMarker: "resourceTitleMarker",
  resourceTitleString: "resourceTitleString",
  setextHeading: "setextHeading",
  setextHeadingText: "setextHeadingText",
  setextHeadingLine: "setextHeadingLine",
  setextHeadingLineSequence: "setextHeadingLineSequence",
  strong: "strong",
  strongSequence: "strongSequence",
  strongText: "strongText",
  thematicBreak: "thematicBreak",
  thematicBreakSequence: "thematicBreakSequence",
  blockQuote: "blockQuote",
  blockQuotePrefix: "blockQuotePrefix",
  blockQuoteMarker: "blockQuoteMarker",
  blockQuotePrefixWhitespace: "blockQuotePrefixWhitespace",
  listOrdered: "listOrdered",
  listUnordered: "listUnordered",
  listItemIndent: "listItemIndent",
  listItemMarker: "listItemMarker",
  listItemPrefix: "listItemPrefix",
  listItemPrefixWhitespace: "listItemPrefixWhitespace",
  listItemValue: "listItemValue",
  chunkDocument: "chunkDocument",
  chunkContent: "chunkContent",
  chunkFlow: "chunkFlow",
  chunkText: "chunkText",
  chunkString: "chunkString"
};
// node_modules/micromark-util-symbol/lib/values.js
var values = {
  ht: "\t",
  lf: `
`,
  cr: "\r",
  space: " ",
  exclamationMark: "!",
  quotationMark: '"',
  numberSign: "#",
  dollarSign: "$",
  percentSign: "%",
  ampersand: "&",
  apostrophe: "'",
  leftParenthesis: "(",
  rightParenthesis: ")",
  asterisk: "*",
  plusSign: "+",
  comma: ",",
  dash: "-",
  dot: ".",
  slash: "/",
  digit0: "0",
  digit1: "1",
  digit2: "2",
  digit3: "3",
  digit4: "4",
  digit5: "5",
  digit6: "6",
  digit7: "7",
  digit8: "8",
  digit9: "9",
  colon: ":",
  semicolon: ";",
  lessThan: "<",
  equalsTo: "=",
  greaterThan: ">",
  questionMark: "?",
  atSign: "@",
  uppercaseA: "A",
  uppercaseB: "B",
  uppercaseC: "C",
  uppercaseD: "D",
  uppercaseE: "E",
  uppercaseF: "F",
  uppercaseG: "G",
  uppercaseH: "H",
  uppercaseI: "I",
  uppercaseJ: "J",
  uppercaseK: "K",
  uppercaseL: "L",
  uppercaseM: "M",
  uppercaseN: "N",
  uppercaseO: "O",
  uppercaseP: "P",
  uppercaseQ: "Q",
  uppercaseR: "R",
  uppercaseS: "S",
  uppercaseT: "T",
  uppercaseU: "U",
  uppercaseV: "V",
  uppercaseW: "W",
  uppercaseX: "X",
  uppercaseY: "Y",
  uppercaseZ: "Z",
  leftSquareBracket: "[",
  backslash: "\\",
  rightSquareBracket: "]",
  caret: "^",
  underscore: "_",
  graveAccent: "`",
  lowercaseA: "a",
  lowercaseB: "b",
  lowercaseC: "c",
  lowercaseD: "d",
  lowercaseE: "e",
  lowercaseF: "f",
  lowercaseG: "g",
  lowercaseH: "h",
  lowercaseI: "i",
  lowercaseJ: "j",
  lowercaseK: "k",
  lowercaseL: "l",
  lowercaseM: "m",
  lowercaseN: "n",
  lowercaseO: "o",
  lowercaseP: "p",
  lowercaseQ: "q",
  lowercaseR: "r",
  lowercaseS: "s",
  lowercaseT: "t",
  lowercaseU: "u",
  lowercaseV: "v",
  lowercaseW: "w",
  lowercaseX: "x",
  lowercaseY: "y",
  lowercaseZ: "z",
  leftCurlyBrace: "{",
  verticalBar: "|",
  rightCurlyBrace: "}",
  tilde: "~",
  replacementCharacter: "�"
};
// node_modules/micromark-util-chunked/dev/index.js
function splice(list, start, remove, items) {
  const end = list.length;
  let chunkStart = 0;
  let parameters;
  if (start < 0) {
    start = -start > end ? 0 : end + start;
  } else {
    start = start > end ? end : start;
  }
  remove = remove > 0 ? remove : 0;
  if (items.length < constants.v8MaxSafeChunkSize) {
    parameters = Array.from(items);
    parameters.unshift(start, remove);
    list.splice(...parameters);
  } else {
    if (remove)
      list.splice(start, remove);
    while (chunkStart < items.length) {
      parameters = items.slice(chunkStart, chunkStart + constants.v8MaxSafeChunkSize);
      parameters.unshift(start, 0);
      list.splice(...parameters);
      chunkStart += constants.v8MaxSafeChunkSize;
      start += constants.v8MaxSafeChunkSize;
    }
  }
}
function push(list, items) {
  if (list.length > 0) {
    splice(list, list.length, 0, items);
    return list;
  }
  return items;
}

// node_modules/micromark-util-combine-extensions/index.js
var hasOwnProperty = {}.hasOwnProperty;
function combineExtensions(extensions) {
  const all2 = {};
  let index = -1;
  while (++index < extensions.length) {
    syntaxExtension(all2, extensions[index]);
  }
  return all2;
}
function syntaxExtension(all2, extension) {
  let hook;
  for (hook in extension) {
    const maybe = hasOwnProperty.call(all2, hook) ? all2[hook] : undefined;
    const left = maybe || (all2[hook] = {});
    const right = extension[hook];
    let code;
    if (right) {
      for (code in right) {
        if (!hasOwnProperty.call(left, code))
          left[code] = [];
        const value = right[code];
        constructs(left[code], Array.isArray(value) ? value : value ? [value] : []);
      }
    }
  }
}
function constructs(existing, list) {
  let index = -1;
  const before = [];
  while (++index < list.length) {
    (list[index].add === "after" ? existing : before).push(list[index]);
  }
  splice(existing, 0, 0, before);
}

// node_modules/micromark-util-decode-numeric-character-reference/dev/index.js
function decodeNumericCharacterReference(value, base) {
  const code = Number.parseInt(value, base);
  if (code < codes.ht || code === codes.vt || code > codes.cr && code < codes.space || code > codes.tilde && code < 160 || code > 55295 && code < 57344 || code > 64975 && code < 65008 || (code & 65535) === 65535 || (code & 65535) === 65534 || code > 1114111) {
    return values.replacementCharacter;
  }
  return String.fromCodePoint(code);
}

// node_modules/micromark-util-normalize-identifier/dev/index.js
function normalizeIdentifier(value) {
  return value.replace(/[\t\n\r ]+/g, values.space).replace(/^ | $/g, "").toLowerCase().toUpperCase();
}

// node_modules/micromark-util-character/dev/index.js
var asciiAlpha = regexCheck(/[A-Za-z]/);
var asciiAlphanumeric = regexCheck(/[\dA-Za-z]/);
var asciiAtext = regexCheck(/[#-'*+\--9=?A-Z^-~]/);
function asciiControl(code) {
  return code !== null && (code < codes.space || code === codes.del);
}
var asciiDigit = regexCheck(/\d/);
var asciiHexDigit = regexCheck(/[\dA-Fa-f]/);
var asciiPunctuation = regexCheck(/[!-/:-@[-`{-~]/);
function markdownLineEnding(code) {
  return code !== null && code < codes.horizontalTab;
}
function markdownLineEndingOrSpace(code) {
  return code !== null && (code < codes.nul || code === codes.space);
}
function markdownSpace(code) {
  return code === codes.horizontalTab || code === codes.virtualSpace || code === codes.space;
}
var unicodePunctuation = regexCheck(/\p{P}|\p{S}/u);
var unicodeWhitespace = regexCheck(/\s/);
function regexCheck(regex) {
  return check;
  function check(code) {
    return code !== null && code > -1 && regex.test(String.fromCharCode(code));
  }
}

// node_modules/micromark-factory-space/dev/index.js
function factorySpace(effects, ok2, type, max) {
  const limit = max ? max - 1 : Number.POSITIVE_INFINITY;
  let size = 0;
  return start;
  function start(code) {
    if (markdownSpace(code)) {
      effects.enter(type);
      return prefix(code);
    }
    return ok2(code);
  }
  function prefix(code) {
    if (markdownSpace(code) && size++ < limit) {
      effects.consume(code);
      return prefix;
    }
    effects.exit(type);
    return ok2(code);
  }
}

// node_modules/micromark/dev/lib/initialize/content.js
var content = { tokenize: initializeContent };
function initializeContent(effects) {
  const contentStart = effects.attempt(this.parser.constructs.contentInitial, afterContentStartConstruct, paragraphInitial);
  let previous;
  return contentStart;
  function afterContentStartConstruct(code) {
    ok(code === codes.eof || markdownLineEnding(code), "expected eol or eof");
    if (code === codes.eof) {
      effects.consume(code);
      return;
    }
    effects.enter(types.lineEnding);
    effects.consume(code);
    effects.exit(types.lineEnding);
    return factorySpace(effects, contentStart, types.linePrefix);
  }
  function paragraphInitial(code) {
    ok(code !== codes.eof && !markdownLineEnding(code), "expected anything other than a line ending or EOF");
    effects.enter(types.paragraph);
    return lineStart(code);
  }
  function lineStart(code) {
    const token = effects.enter(types.chunkText, {
      contentType: constants.contentTypeText,
      previous
    });
    if (previous) {
      previous.next = token;
    }
    previous = token;
    return data(code);
  }
  function data(code) {
    if (code === codes.eof) {
      effects.exit(types.chunkText);
      effects.exit(types.paragraph);
      effects.consume(code);
      return;
    }
    if (markdownLineEnding(code)) {
      effects.consume(code);
      effects.exit(types.chunkText);
      return lineStart;
    }
    effects.consume(code);
    return data;
  }
}

// node_modules/micromark/dev/lib/initialize/document.js
var document2 = { tokenize: initializeDocument };
var containerConstruct = { tokenize: tokenizeContainer };
function initializeDocument(effects) {
  const self = this;
  const stack = [];
  let continued = 0;
  let childFlow;
  let childToken;
  let lineStartOffset;
  return start;
  function start(code) {
    if (continued < stack.length) {
      const item = stack[continued];
      self.containerState = item[1];
      ok(item[0].continuation, "expected `continuation` to be defined on container construct");
      return effects.attempt(item[0].continuation, documentContinue, checkNewContainers)(code);
    }
    return checkNewContainers(code);
  }
  function documentContinue(code) {
    ok(self.containerState, "expected `containerState` to be defined after continuation");
    continued++;
    if (self.containerState._closeFlow) {
      self.containerState._closeFlow = undefined;
      if (childFlow) {
        closeFlow();
      }
      const indexBeforeExits = self.events.length;
      let indexBeforeFlow = indexBeforeExits;
      let point;
      while (indexBeforeFlow--) {
        if (self.events[indexBeforeFlow][0] === "exit" && self.events[indexBeforeFlow][1].type === types.chunkFlow) {
          point = self.events[indexBeforeFlow][1].end;
          break;
        }
      }
      ok(point, "could not find previous flow chunk");
      exitContainers(continued);
      let index = indexBeforeExits;
      while (index < self.events.length) {
        self.events[index][1].end = { ...point };
        index++;
      }
      splice(self.events, indexBeforeFlow + 1, 0, self.events.slice(indexBeforeExits));
      self.events.length = index;
      return checkNewContainers(code);
    }
    return start(code);
  }
  function checkNewContainers(code) {
    if (continued === stack.length) {
      if (!childFlow) {
        return documentContinued(code);
      }
      if (childFlow.currentConstruct && childFlow.currentConstruct.concrete) {
        return flowStart(code);
      }
      self.interrupt = Boolean(childFlow.currentConstruct && !childFlow._gfmTableDynamicInterruptHack);
    }
    self.containerState = {};
    return effects.check(containerConstruct, thereIsANewContainer, thereIsNoNewContainer)(code);
  }
  function thereIsANewContainer(code) {
    if (childFlow)
      closeFlow();
    exitContainers(continued);
    return documentContinued(code);
  }
  function thereIsNoNewContainer(code) {
    self.parser.lazy[self.now().line] = continued !== stack.length;
    lineStartOffset = self.now().offset;
    return flowStart(code);
  }
  function documentContinued(code) {
    self.containerState = {};
    return effects.attempt(containerConstruct, containerContinue, flowStart)(code);
  }
  function containerContinue(code) {
    ok(self.currentConstruct, "expected `currentConstruct` to be defined on tokenizer");
    ok(self.containerState, "expected `containerState` to be defined on tokenizer");
    continued++;
    stack.push([self.currentConstruct, self.containerState]);
    return documentContinued(code);
  }
  function flowStart(code) {
    if (code === codes.eof) {
      if (childFlow)
        closeFlow();
      exitContainers(0);
      effects.consume(code);
      return;
    }
    childFlow = childFlow || self.parser.flow(self.now());
    effects.enter(types.chunkFlow, {
      _tokenizer: childFlow,
      contentType: constants.contentTypeFlow,
      previous: childToken
    });
    return flowContinue(code);
  }
  function flowContinue(code) {
    if (code === codes.eof) {
      writeToChild(effects.exit(types.chunkFlow), true);
      exitContainers(0);
      effects.consume(code);
      return;
    }
    if (markdownLineEnding(code)) {
      effects.consume(code);
      writeToChild(effects.exit(types.chunkFlow));
      continued = 0;
      self.interrupt = undefined;
      return start;
    }
    effects.consume(code);
    return flowContinue;
  }
  function writeToChild(token, endOfFile) {
    ok(childFlow, "expected `childFlow` to be defined when continuing");
    const stream = self.sliceStream(token);
    if (endOfFile)
      stream.push(null);
    token.previous = childToken;
    if (childToken)
      childToken.next = token;
    childToken = token;
    childFlow.defineSkip(token.start);
    childFlow.write(stream);
    if (self.parser.lazy[token.start.line]) {
      let index = childFlow.events.length;
      while (index--) {
        if (childFlow.events[index][1].start.offset < lineStartOffset && (!childFlow.events[index][1].end || childFlow.events[index][1].end.offset > lineStartOffset)) {
          return;
        }
      }
      const indexBeforeExits = self.events.length;
      let indexBeforeFlow = indexBeforeExits;
      let seen;
      let point;
      while (indexBeforeFlow--) {
        if (self.events[indexBeforeFlow][0] === "exit" && self.events[indexBeforeFlow][1].type === types.chunkFlow) {
          if (seen) {
            point = self.events[indexBeforeFlow][1].end;
            break;
          }
          seen = true;
        }
      }
      ok(point, "could not find previous flow chunk");
      exitContainers(continued);
      index = indexBeforeExits;
      while (index < self.events.length) {
        self.events[index][1].end = { ...point };
        index++;
      }
      splice(self.events, indexBeforeFlow + 1, 0, self.events.slice(indexBeforeExits));
      self.events.length = index;
    }
  }
  function exitContainers(size) {
    let index = stack.length;
    while (index-- > size) {
      const entry = stack[index];
      self.containerState = entry[1];
      ok(entry[0].exit, "expected `exit` to be defined on container construct");
      entry[0].exit.call(self, effects);
    }
    stack.length = size;
  }
  function closeFlow() {
    ok(self.containerState, "expected `containerState` to be defined when closing flow");
    ok(childFlow, "expected `childFlow` to be defined when closing it");
    childFlow.write([codes.eof]);
    childToken = undefined;
    childFlow = undefined;
    self.containerState._closeFlow = undefined;
  }
}
function tokenizeContainer(effects, ok2, nok) {
  ok(this.parser.constructs.disable.null, "expected `disable.null` to be populated");
  return factorySpace(effects, effects.attempt(this.parser.constructs.document, ok2, nok), types.linePrefix, this.parser.constructs.disable.null.includes("codeIndented") ? undefined : constants.tabSize);
}

// node_modules/micromark-util-classify-character/dev/index.js
function classifyCharacter(code) {
  if (code === codes.eof || markdownLineEndingOrSpace(code) || unicodeWhitespace(code)) {
    return constants.characterGroupWhitespace;
  }
  if (unicodePunctuation(code)) {
    return constants.characterGroupPunctuation;
  }
}

// node_modules/micromark-util-resolve-all/index.js
function resolveAll(constructs2, events, context) {
  const called = [];
  let index = -1;
  while (++index < constructs2.length) {
    const resolve3 = constructs2[index].resolveAll;
    if (resolve3 && !called.includes(resolve3)) {
      events = resolve3(events, context);
      called.push(resolve3);
    }
  }
  return events;
}

// node_modules/micromark-core-commonmark/dev/lib/attention.js
var attention = {
  name: "attention",
  resolveAll: resolveAllAttention,
  tokenize: tokenizeAttention
};
function resolveAllAttention(events, context) {
  let index = -1;
  let open;
  let group;
  let text;
  let openingSequence;
  let closingSequence;
  let use;
  let nextEvents;
  let offset;
  while (++index < events.length) {
    if (events[index][0] === "enter" && events[index][1].type === "attentionSequence" && events[index][1]._close) {
      open = index;
      while (open--) {
        if (events[open][0] === "exit" && events[open][1].type === "attentionSequence" && events[open][1]._open && context.sliceSerialize(events[open][1]).charCodeAt(0) === context.sliceSerialize(events[index][1]).charCodeAt(0)) {
          if ((events[open][1]._close || events[index][1]._open) && (events[index][1].end.offset - events[index][1].start.offset) % 3 && !((events[open][1].end.offset - events[open][1].start.offset + events[index][1].end.offset - events[index][1].start.offset) % 3)) {
            continue;
          }
          use = events[open][1].end.offset - events[open][1].start.offset > 1 && events[index][1].end.offset - events[index][1].start.offset > 1 ? 2 : 1;
          const start = { ...events[open][1].end };
          const end = { ...events[index][1].start };
          movePoint(start, -use);
          movePoint(end, use);
          openingSequence = {
            type: use > 1 ? types.strongSequence : types.emphasisSequence,
            start,
            end: { ...events[open][1].end }
          };
          closingSequence = {
            type: use > 1 ? types.strongSequence : types.emphasisSequence,
            start: { ...events[index][1].start },
            end
          };
          text = {
            type: use > 1 ? types.strongText : types.emphasisText,
            start: { ...events[open][1].end },
            end: { ...events[index][1].start }
          };
          group = {
            type: use > 1 ? types.strong : types.emphasis,
            start: { ...openingSequence.start },
            end: { ...closingSequence.end }
          };
          events[open][1].end = { ...openingSequence.start };
          events[index][1].start = { ...closingSequence.end };
          nextEvents = [];
          if (events[open][1].end.offset - events[open][1].start.offset) {
            nextEvents = push(nextEvents, [
              ["enter", events[open][1], context],
              ["exit", events[open][1], context]
            ]);
          }
          nextEvents = push(nextEvents, [
            ["enter", group, context],
            ["enter", openingSequence, context],
            ["exit", openingSequence, context],
            ["enter", text, context]
          ]);
          ok(context.parser.constructs.insideSpan.null, "expected `insideSpan` to be populated");
          nextEvents = push(nextEvents, resolveAll(context.parser.constructs.insideSpan.null, events.slice(open + 1, index), context));
          nextEvents = push(nextEvents, [
            ["exit", text, context],
            ["enter", closingSequence, context],
            ["exit", closingSequence, context],
            ["exit", group, context]
          ]);
          if (events[index][1].end.offset - events[index][1].start.offset) {
            offset = 2;
            nextEvents = push(nextEvents, [
              ["enter", events[index][1], context],
              ["exit", events[index][1], context]
            ]);
          } else {
            offset = 0;
          }
          splice(events, open - 1, index - open + 3, nextEvents);
          index = open + nextEvents.length - offset - 2;
          break;
        }
      }
    }
  }
  index = -1;
  while (++index < events.length) {
    if (events[index][1].type === "attentionSequence") {
      events[index][1].type = "data";
    }
  }
  return events;
}
function tokenizeAttention(effects, ok2) {
  const attentionMarkers = this.parser.constructs.attentionMarkers.null;
  const previous = this.previous;
  const before = classifyCharacter(previous);
  let marker;
  return start;
  function start(code) {
    ok(code === codes.asterisk || code === codes.underscore, "expected asterisk or underscore");
    marker = code;
    effects.enter("attentionSequence");
    return inside(code);
  }
  function inside(code) {
    if (code === marker) {
      effects.consume(code);
      return inside;
    }
    const token = effects.exit("attentionSequence");
    const after = classifyCharacter(code);
    ok(attentionMarkers, "expected `attentionMarkers` to be populated");
    const open = !after || after === constants.characterGroupPunctuation && before || attentionMarkers.includes(code);
    const close = !before || before === constants.characterGroupPunctuation && after || attentionMarkers.includes(previous);
    token._open = Boolean(marker === codes.asterisk ? open : open && (before || !close));
    token._close = Boolean(marker === codes.asterisk ? close : close && (after || !open));
    return ok2(code);
  }
}
function movePoint(point, offset) {
  point.column += offset;
  point.offset += offset;
  point._bufferIndex += offset;
}
// node_modules/micromark-core-commonmark/dev/lib/autolink.js
var autolink = { name: "autolink", tokenize: tokenizeAutolink };
function tokenizeAutolink(effects, ok2, nok) {
  let size = 0;
  return start;
  function start(code) {
    ok(code === codes.lessThan, "expected `<`");
    effects.enter(types.autolink);
    effects.enter(types.autolinkMarker);
    effects.consume(code);
    effects.exit(types.autolinkMarker);
    effects.enter(types.autolinkProtocol);
    return open;
  }
  function open(code) {
    if (asciiAlpha(code)) {
      effects.consume(code);
      return schemeOrEmailAtext;
    }
    if (code === codes.atSign) {
      return nok(code);
    }
    return emailAtext(code);
  }
  function schemeOrEmailAtext(code) {
    if (code === codes.plusSign || code === codes.dash || code === codes.dot || asciiAlphanumeric(code)) {
      size = 1;
      return schemeInsideOrEmailAtext(code);
    }
    return emailAtext(code);
  }
  function schemeInsideOrEmailAtext(code) {
    if (code === codes.colon) {
      effects.consume(code);
      size = 0;
      return urlInside;
    }
    if ((code === codes.plusSign || code === codes.dash || code === codes.dot || asciiAlphanumeric(code)) && size++ < constants.autolinkSchemeSizeMax) {
      effects.consume(code);
      return schemeInsideOrEmailAtext;
    }
    size = 0;
    return emailAtext(code);
  }
  function urlInside(code) {
    if (code === codes.greaterThan) {
      effects.exit(types.autolinkProtocol);
      effects.enter(types.autolinkMarker);
      effects.consume(code);
      effects.exit(types.autolinkMarker);
      effects.exit(types.autolink);
      return ok2;
    }
    if (code === codes.eof || code === codes.space || code === codes.lessThan || asciiControl(code)) {
      return nok(code);
    }
    effects.consume(code);
    return urlInside;
  }
  function emailAtext(code) {
    if (code === codes.atSign) {
      effects.consume(code);
      return emailAtSignOrDot;
    }
    if (asciiAtext(code)) {
      effects.consume(code);
      return emailAtext;
    }
    return nok(code);
  }
  function emailAtSignOrDot(code) {
    return asciiAlphanumeric(code) ? emailLabel(code) : nok(code);
  }
  function emailLabel(code) {
    if (code === codes.dot) {
      effects.consume(code);
      size = 0;
      return emailAtSignOrDot;
    }
    if (code === codes.greaterThan) {
      effects.exit(types.autolinkProtocol).type = types.autolinkEmail;
      effects.enter(types.autolinkMarker);
      effects.consume(code);
      effects.exit(types.autolinkMarker);
      effects.exit(types.autolink);
      return ok2;
    }
    return emailValue(code);
  }
  function emailValue(code) {
    if ((code === codes.dash || asciiAlphanumeric(code)) && size++ < constants.autolinkDomainSizeMax) {
      const next = code === codes.dash ? emailValue : emailLabel;
      effects.consume(code);
      return next;
    }
    return nok(code);
  }
}
// node_modules/micromark-core-commonmark/dev/lib/blank-line.js
var blankLine = { partial: true, tokenize: tokenizeBlankLine };
function tokenizeBlankLine(effects, ok2, nok) {
  return start;
  function start(code) {
    return markdownSpace(code) ? factorySpace(effects, after, types.linePrefix)(code) : after(code);
  }
  function after(code) {
    return code === codes.eof || markdownLineEnding(code) ? ok2(code) : nok(code);
  }
}
// node_modules/micromark-core-commonmark/dev/lib/block-quote.js
var blockQuote = {
  continuation: { tokenize: tokenizeBlockQuoteContinuation },
  exit,
  name: "blockQuote",
  tokenize: tokenizeBlockQuoteStart
};
function tokenizeBlockQuoteStart(effects, ok2, nok) {
  const self = this;
  return start;
  function start(code) {
    if (code === codes.greaterThan) {
      const state = self.containerState;
      ok(state, "expected `containerState` to be defined in container");
      if (!state.open) {
        effects.enter(types.blockQuote, { _container: true });
        state.open = true;
      }
      effects.enter(types.blockQuotePrefix);
      effects.enter(types.blockQuoteMarker);
      effects.consume(code);
      effects.exit(types.blockQuoteMarker);
      return after;
    }
    return nok(code);
  }
  function after(code) {
    if (markdownSpace(code)) {
      effects.enter(types.blockQuotePrefixWhitespace);
      effects.consume(code);
      effects.exit(types.blockQuotePrefixWhitespace);
      effects.exit(types.blockQuotePrefix);
      return ok2;
    }
    effects.exit(types.blockQuotePrefix);
    return ok2(code);
  }
}
function tokenizeBlockQuoteContinuation(effects, ok2, nok) {
  const self = this;
  return contStart;
  function contStart(code) {
    if (markdownSpace(code)) {
      ok(self.parser.constructs.disable.null, "expected `disable.null` to be populated");
      return factorySpace(effects, contBefore, types.linePrefix, self.parser.constructs.disable.null.includes("codeIndented") ? undefined : constants.tabSize)(code);
    }
    return contBefore(code);
  }
  function contBefore(code) {
    return effects.attempt(blockQuote, ok2, nok)(code);
  }
}
function exit(effects) {
  effects.exit(types.blockQuote);
}
// node_modules/micromark-core-commonmark/dev/lib/character-escape.js
var characterEscape = {
  name: "characterEscape",
  tokenize: tokenizeCharacterEscape
};
function tokenizeCharacterEscape(effects, ok2, nok) {
  return start;
  function start(code) {
    ok(code === codes.backslash, "expected `\\`");
    effects.enter(types.characterEscape);
    effects.enter(types.escapeMarker);
    effects.consume(code);
    effects.exit(types.escapeMarker);
    return inside;
  }
  function inside(code) {
    if (asciiPunctuation(code)) {
      effects.enter(types.characterEscapeValue);
      effects.consume(code);
      effects.exit(types.characterEscapeValue);
      effects.exit(types.characterEscape);
      return ok2;
    }
    return nok(code);
  }
}
// node_modules/micromark-core-commonmark/dev/lib/character-reference.js
var characterReference = {
  name: "characterReference",
  tokenize: tokenizeCharacterReference
};
function tokenizeCharacterReference(effects, ok2, nok) {
  const self = this;
  let size = 0;
  let max;
  let test;
  return start;
  function start(code) {
    ok(code === codes.ampersand, "expected `&`");
    effects.enter(types.characterReference);
    effects.enter(types.characterReferenceMarker);
    effects.consume(code);
    effects.exit(types.characterReferenceMarker);
    return open;
  }
  function open(code) {
    if (code === codes.numberSign) {
      effects.enter(types.characterReferenceMarkerNumeric);
      effects.consume(code);
      effects.exit(types.characterReferenceMarkerNumeric);
      return numeric;
    }
    effects.enter(types.characterReferenceValue);
    max = constants.characterReferenceNamedSizeMax;
    test = asciiAlphanumeric;
    return value(code);
  }
  function numeric(code) {
    if (code === codes.uppercaseX || code === codes.lowercaseX) {
      effects.enter(types.characterReferenceMarkerHexadecimal);
      effects.consume(code);
      effects.exit(types.characterReferenceMarkerHexadecimal);
      effects.enter(types.characterReferenceValue);
      max = constants.characterReferenceHexadecimalSizeMax;
      test = asciiHexDigit;
      return value;
    }
    effects.enter(types.characterReferenceValue);
    max = constants.characterReferenceDecimalSizeMax;
    test = asciiDigit;
    return value(code);
  }
  function value(code) {
    if (code === codes.semicolon && size) {
      const token = effects.exit(types.characterReferenceValue);
      if (test === asciiAlphanumeric && !decodeNamedCharacterReference(self.sliceSerialize(token))) {
        return nok(code);
      }
      effects.enter(types.characterReferenceMarker);
      effects.consume(code);
      effects.exit(types.characterReferenceMarker);
      effects.exit(types.characterReference);
      return ok2;
    }
    if (test(code) && size++ < max) {
      effects.consume(code);
      return value;
    }
    return nok(code);
  }
}
// node_modules/micromark-core-commonmark/dev/lib/code-fenced.js
var nonLazyContinuation = {
  partial: true,
  tokenize: tokenizeNonLazyContinuation
};
var codeFenced = {
  concrete: true,
  name: "codeFenced",
  tokenize: tokenizeCodeFenced
};
function tokenizeCodeFenced(effects, ok2, nok) {
  const self = this;
  const closeStart = { partial: true, tokenize: tokenizeCloseStart };
  let initialPrefix = 0;
  let sizeOpen = 0;
  let marker;
  return start;
  function start(code) {
    return beforeSequenceOpen(code);
  }
  function beforeSequenceOpen(code) {
    ok(code === codes.graveAccent || code === codes.tilde, "expected `` ` `` or `~`");
    const tail = self.events[self.events.length - 1];
    initialPrefix = tail && tail[1].type === types.linePrefix ? tail[2].sliceSerialize(tail[1], true).length : 0;
    marker = code;
    effects.enter(types.codeFenced);
    effects.enter(types.codeFencedFence);
    effects.enter(types.codeFencedFenceSequence);
    return sequenceOpen(code);
  }
  function sequenceOpen(code) {
    if (code === marker) {
      sizeOpen++;
      effects.consume(code);
      return sequenceOpen;
    }
    if (sizeOpen < constants.codeFencedSequenceSizeMin) {
      return nok(code);
    }
    effects.exit(types.codeFencedFenceSequence);
    return markdownSpace(code) ? factorySpace(effects, infoBefore, types.whitespace)(code) : infoBefore(code);
  }
  function infoBefore(code) {
    if (code === codes.eof || markdownLineEnding(code)) {
      effects.exit(types.codeFencedFence);
      return self.interrupt ? ok2(code) : effects.check(nonLazyContinuation, atNonLazyBreak, after)(code);
    }
    effects.enter(types.codeFencedFenceInfo);
    effects.enter(types.chunkString, { contentType: constants.contentTypeString });
    return info(code);
  }
  function info(code) {
    if (code === codes.eof || markdownLineEnding(code)) {
      effects.exit(types.chunkString);
      effects.exit(types.codeFencedFenceInfo);
      return infoBefore(code);
    }
    if (markdownSpace(code)) {
      effects.exit(types.chunkString);
      effects.exit(types.codeFencedFenceInfo);
      return factorySpace(effects, metaBefore, types.whitespace)(code);
    }
    if (code === codes.graveAccent && code === marker) {
      return nok(code);
    }
    effects.consume(code);
    return info;
  }
  function metaBefore(code) {
    if (code === codes.eof || markdownLineEnding(code)) {
      return infoBefore(code);
    }
    effects.enter(types.codeFencedFenceMeta);
    effects.enter(types.chunkString, { contentType: constants.contentTypeString });
    return meta(code);
  }
  function meta(code) {
    if (code === codes.eof || markdownLineEnding(code)) {
      effects.exit(types.chunkString);
      effects.exit(types.codeFencedFenceMeta);
      return infoBefore(code);
    }
    if (code === codes.graveAccent && code === marker) {
      return nok(code);
    }
    effects.consume(code);
    return meta;
  }
  function atNonLazyBreak(code) {
    ok(markdownLineEnding(code), "expected eol");
    return effects.attempt(closeStart, after, contentBefore)(code);
  }
  function contentBefore(code) {
    ok(markdownLineEnding(code), "expected eol");
    effects.enter(types.lineEnding);
    effects.consume(code);
    effects.exit(types.lineEnding);
    return contentStart;
  }
  function contentStart(code) {
    return initialPrefix > 0 && markdownSpace(code) ? factorySpace(effects, beforeContentChunk, types.linePrefix, initialPrefix + 1)(code) : beforeContentChunk(code);
  }
  function beforeContentChunk(code) {
    if (code === codes.eof || markdownLineEnding(code)) {
      return effects.check(nonLazyContinuation, atNonLazyBreak, after)(code);
    }
    effects.enter(types.codeFlowValue);
    return contentChunk(code);
  }
  function contentChunk(code) {
    if (code === codes.eof || markdownLineEnding(code)) {
      effects.exit(types.codeFlowValue);
      return beforeContentChunk(code);
    }
    effects.consume(code);
    return contentChunk;
  }
  function after(code) {
    effects.exit(types.codeFenced);
    return ok2(code);
  }
  function tokenizeCloseStart(effects2, ok3, nok2) {
    let size = 0;
    return startBefore;
    function startBefore(code) {
      ok(markdownLineEnding(code), "expected eol");
      effects2.enter(types.lineEnding);
      effects2.consume(code);
      effects2.exit(types.lineEnding);
      return start2;
    }
    function start2(code) {
      ok(self.parser.constructs.disable.null, "expected `disable.null` to be populated");
      effects2.enter(types.codeFencedFence);
      return markdownSpace(code) ? factorySpace(effects2, beforeSequenceClose, types.linePrefix, self.parser.constructs.disable.null.includes("codeIndented") ? undefined : constants.tabSize)(code) : beforeSequenceClose(code);
    }
    function beforeSequenceClose(code) {
      if (code === marker) {
        effects2.enter(types.codeFencedFenceSequence);
        return sequenceClose(code);
      }
      return nok2(code);
    }
    function sequenceClose(code) {
      if (code === marker) {
        size++;
        effects2.consume(code);
        return sequenceClose;
      }
      if (size >= sizeOpen) {
        effects2.exit(types.codeFencedFenceSequence);
        return markdownSpace(code) ? factorySpace(effects2, sequenceCloseAfter, types.whitespace)(code) : sequenceCloseAfter(code);
      }
      return nok2(code);
    }
    function sequenceCloseAfter(code) {
      if (code === codes.eof || markdownLineEnding(code)) {
        effects2.exit(types.codeFencedFence);
        return ok3(code);
      }
      return nok2(code);
    }
  }
}
function tokenizeNonLazyContinuation(effects, ok2, nok) {
  const self = this;
  return start;
  function start(code) {
    if (code === codes.eof) {
      return nok(code);
    }
    ok(markdownLineEnding(code), "expected eol");
    effects.enter(types.lineEnding);
    effects.consume(code);
    effects.exit(types.lineEnding);
    return lineStart;
  }
  function lineStart(code) {
    return self.parser.lazy[self.now().line] ? nok(code) : ok2(code);
  }
}
// node_modules/micromark-core-commonmark/dev/lib/code-indented.js
var codeIndented = {
  name: "codeIndented",
  tokenize: tokenizeCodeIndented
};
var furtherStart = { partial: true, tokenize: tokenizeFurtherStart };
function tokenizeCodeIndented(effects, ok2, nok) {
  const self = this;
  return start;
  function start(code) {
    ok(markdownSpace(code));
    effects.enter(types.codeIndented);
    return factorySpace(effects, afterPrefix, types.linePrefix, constants.tabSize + 1)(code);
  }
  function afterPrefix(code) {
    const tail = self.events[self.events.length - 1];
    return tail && tail[1].type === types.linePrefix && tail[2].sliceSerialize(tail[1], true).length >= constants.tabSize ? atBreak(code) : nok(code);
  }
  function atBreak(code) {
    if (code === codes.eof) {
      return after(code);
    }
    if (markdownLineEnding(code)) {
      return effects.attempt(furtherStart, atBreak, after)(code);
    }
    effects.enter(types.codeFlowValue);
    return inside(code);
  }
  function inside(code) {
    if (code === codes.eof || markdownLineEnding(code)) {
      effects.exit(types.codeFlowValue);
      return atBreak(code);
    }
    effects.consume(code);
    return inside;
  }
  function after(code) {
    effects.exit(types.codeIndented);
    return ok2(code);
  }
}
function tokenizeFurtherStart(effects, ok2, nok) {
  const self = this;
  return furtherStart2;
  function furtherStart2(code) {
    if (self.parser.lazy[self.now().line]) {
      return nok(code);
    }
    if (markdownLineEnding(code)) {
      effects.enter(types.lineEnding);
      effects.consume(code);
      effects.exit(types.lineEnding);
      return furtherStart2;
    }
    return factorySpace(effects, afterPrefix, types.linePrefix, constants.tabSize + 1)(code);
  }
  function afterPrefix(code) {
    const tail = self.events[self.events.length - 1];
    return tail && tail[1].type === types.linePrefix && tail[2].sliceSerialize(tail[1], true).length >= constants.tabSize ? ok2(code) : markdownLineEnding(code) ? furtherStart2(code) : nok(code);
  }
}
// node_modules/micromark-core-commonmark/dev/lib/code-text.js
var codeText = {
  name: "codeText",
  previous,
  resolve: resolveCodeText,
  tokenize: tokenizeCodeText
};
function resolveCodeText(events) {
  let tailExitIndex = events.length - 4;
  let headEnterIndex = 3;
  let index;
  let enter;
  if ((events[headEnterIndex][1].type === types.lineEnding || events[headEnterIndex][1].type === "space") && (events[tailExitIndex][1].type === types.lineEnding || events[tailExitIndex][1].type === "space")) {
    index = headEnterIndex;
    while (++index < tailExitIndex) {
      if (events[index][1].type === types.codeTextData) {
        events[headEnterIndex][1].type = types.codeTextPadding;
        events[tailExitIndex][1].type = types.codeTextPadding;
        headEnterIndex += 2;
        tailExitIndex -= 2;
        break;
      }
    }
  }
  index = headEnterIndex - 1;
  tailExitIndex++;
  while (++index <= tailExitIndex) {
    if (enter === undefined) {
      if (index !== tailExitIndex && events[index][1].type !== types.lineEnding) {
        enter = index;
      }
    } else if (index === tailExitIndex || events[index][1].type === types.lineEnding) {
      events[enter][1].type = types.codeTextData;
      if (index !== enter + 2) {
        events[enter][1].end = events[index - 1][1].end;
        events.splice(enter + 2, index - enter - 2);
        tailExitIndex -= index - enter - 2;
        index = enter + 2;
      }
      enter = undefined;
    }
  }
  return events;
}
function previous(code) {
  return code !== codes.graveAccent || this.events[this.events.length - 1][1].type === types.characterEscape;
}
function tokenizeCodeText(effects, ok2, nok) {
  const self = this;
  let sizeOpen = 0;
  let size;
  let token;
  return start;
  function start(code) {
    ok(code === codes.graveAccent, "expected `` ` ``");
    ok(previous.call(self, self.previous), "expected correct previous");
    effects.enter(types.codeText);
    effects.enter(types.codeTextSequence);
    return sequenceOpen(code);
  }
  function sequenceOpen(code) {
    if (code === codes.graveAccent) {
      effects.consume(code);
      sizeOpen++;
      return sequenceOpen;
    }
    effects.exit(types.codeTextSequence);
    return between(code);
  }
  function between(code) {
    if (code === codes.eof) {
      return nok(code);
    }
    if (code === codes.space) {
      effects.enter("space");
      effects.consume(code);
      effects.exit("space");
      return between;
    }
    if (code === codes.graveAccent) {
      token = effects.enter(types.codeTextSequence);
      size = 0;
      return sequenceClose(code);
    }
    if (markdownLineEnding(code)) {
      effects.enter(types.lineEnding);
      effects.consume(code);
      effects.exit(types.lineEnding);
      return between;
    }
    effects.enter(types.codeTextData);
    return data(code);
  }
  function data(code) {
    if (code === codes.eof || code === codes.space || code === codes.graveAccent || markdownLineEnding(code)) {
      effects.exit(types.codeTextData);
      return between(code);
    }
    effects.consume(code);
    return data;
  }
  function sequenceClose(code) {
    if (code === codes.graveAccent) {
      effects.consume(code);
      size++;
      return sequenceClose;
    }
    if (size === sizeOpen) {
      effects.exit(types.codeTextSequence);
      effects.exit(types.codeText);
      return ok2(code);
    }
    token.type = types.codeTextData;
    return data(code);
  }
}
// node_modules/micromark-util-subtokenize/dev/lib/splice-buffer.js
class SpliceBuffer {
  constructor(initial) {
    this.left = initial ? [...initial] : [];
    this.right = [];
  }
  get(index) {
    if (index < 0 || index >= this.left.length + this.right.length) {
      throw new RangeError("Cannot access index `" + index + "` in a splice buffer of size `" + (this.left.length + this.right.length) + "`");
    }
    if (index < this.left.length)
      return this.left[index];
    return this.right[this.right.length - index + this.left.length - 1];
  }
  get length() {
    return this.left.length + this.right.length;
  }
  shift() {
    this.setCursor(0);
    return this.right.pop();
  }
  slice(start, end) {
    const stop = end === null || end === undefined ? Number.POSITIVE_INFINITY : end;
    if (stop < this.left.length) {
      return this.left.slice(start, stop);
    }
    if (start > this.left.length) {
      return this.right.slice(this.right.length - stop + this.left.length, this.right.length - start + this.left.length).reverse();
    }
    return this.left.slice(start).concat(this.right.slice(this.right.length - stop + this.left.length).reverse());
  }
  splice(start, deleteCount, items) {
    const count = deleteCount || 0;
    this.setCursor(Math.trunc(start));
    const removed = this.right.splice(this.right.length - count, Number.POSITIVE_INFINITY);
    if (items)
      chunkedPush(this.left, items);
    return removed.reverse();
  }
  pop() {
    this.setCursor(Number.POSITIVE_INFINITY);
    return this.left.pop();
  }
  push(item) {
    this.setCursor(Number.POSITIVE_INFINITY);
    this.left.push(item);
  }
  pushMany(items) {
    this.setCursor(Number.POSITIVE_INFINITY);
    chunkedPush(this.left, items);
  }
  unshift(item) {
    this.setCursor(0);
    this.right.push(item);
  }
  unshiftMany(items) {
    this.setCursor(0);
    chunkedPush(this.right, items.reverse());
  }
  setCursor(n) {
    if (n === this.left.length || n > this.left.length && this.right.length === 0 || n < 0 && this.left.length === 0)
      return;
    if (n < this.left.length) {
      const removed = this.left.splice(n, Number.POSITIVE_INFINITY);
      chunkedPush(this.right, removed.reverse());
    } else {
      const removed = this.right.splice(this.left.length + this.right.length - n, Number.POSITIVE_INFINITY);
      chunkedPush(this.left, removed.reverse());
    }
  }
}
function chunkedPush(list, right) {
  let chunkStart = 0;
  if (right.length < constants.v8MaxSafeChunkSize) {
    list.push(...right);
  } else {
    while (chunkStart < right.length) {
      list.push(...right.slice(chunkStart, chunkStart + constants.v8MaxSafeChunkSize));
      chunkStart += constants.v8MaxSafeChunkSize;
    }
  }
}

// node_modules/micromark-util-subtokenize/dev/index.js
function subtokenize(eventsArray) {
  const jumps = {};
  let index = -1;
  let event;
  let lineIndex;
  let otherIndex;
  let otherEvent;
  let parameters;
  let subevents;
  let more;
  const events = new SpliceBuffer(eventsArray);
  while (++index < events.length) {
    while (index in jumps) {
      index = jumps[index];
    }
    event = events.get(index);
    if (index && event[1].type === types.chunkFlow && events.get(index - 1)[1].type === types.listItemPrefix) {
      ok(event[1]._tokenizer, "expected `_tokenizer` on subtokens");
      subevents = event[1]._tokenizer.events;
      otherIndex = 0;
      if (otherIndex < subevents.length && subevents[otherIndex][1].type === types.lineEndingBlank) {
        otherIndex += 2;
      }
      if (otherIndex < subevents.length && subevents[otherIndex][1].type === types.content) {
        while (++otherIndex < subevents.length) {
          if (subevents[otherIndex][1].type === types.content) {
            break;
          }
          if (subevents[otherIndex][1].type === types.chunkText) {
            subevents[otherIndex][1]._isInFirstContentOfListItem = true;
            otherIndex++;
          }
        }
      }
    }
    if (event[0] === "enter") {
      if (event[1].contentType) {
        Object.assign(jumps, subcontent(events, index));
        index = jumps[index];
        more = true;
      }
    } else if (event[1]._container) {
      otherIndex = index;
      lineIndex = undefined;
      while (otherIndex--) {
        otherEvent = events.get(otherIndex);
        if (otherEvent[1].type === types.lineEnding || otherEvent[1].type === types.lineEndingBlank) {
          if (otherEvent[0] === "enter") {
            if (lineIndex) {
              events.get(lineIndex)[1].type = types.lineEndingBlank;
            }
            otherEvent[1].type = types.lineEnding;
            lineIndex = otherIndex;
          }
        } else if (otherEvent[1].type === types.linePrefix || otherEvent[1].type === types.listItemIndent) {} else {
          break;
        }
      }
      if (lineIndex) {
        event[1].end = { ...events.get(lineIndex)[1].start };
        parameters = events.slice(lineIndex, index);
        parameters.unshift(event);
        events.splice(lineIndex, index - lineIndex + 1, parameters);
      }
    }
  }
  splice(eventsArray, 0, Number.POSITIVE_INFINITY, events.slice(0));
  return !more;
}
function subcontent(events, eventIndex) {
  const token = events.get(eventIndex)[1];
  const context = events.get(eventIndex)[2];
  let startPosition = eventIndex - 1;
  const startPositions = [];
  ok(token.contentType, "expected `contentType` on subtokens");
  let tokenizer = token._tokenizer;
  if (!tokenizer) {
    tokenizer = context.parser[token.contentType](token.start);
    if (token._contentTypeTextTrailing) {
      tokenizer._contentTypeTextTrailing = true;
    }
  }
  const childEvents = tokenizer.events;
  const jumps = [];
  const gaps = {};
  let stream;
  let previous2;
  let index = -1;
  let current = token;
  let adjust = 0;
  let start = 0;
  const breaks = [start];
  while (current) {
    while (events.get(++startPosition)[1] !== current) {}
    ok(!previous2 || current.previous === previous2, "expected previous to match");
    ok(!previous2 || previous2.next === current, "expected next to match");
    startPositions.push(startPosition);
    if (!current._tokenizer) {
      stream = context.sliceStream(current);
      if (!current.next) {
        stream.push(codes.eof);
      }
      if (previous2) {
        tokenizer.defineSkip(current.start);
      }
      if (current._isInFirstContentOfListItem) {
        tokenizer._gfmTasklistFirstContentOfListItem = true;
      }
      tokenizer.write(stream);
      if (current._isInFirstContentOfListItem) {
        tokenizer._gfmTasklistFirstContentOfListItem = undefined;
      }
    }
    previous2 = current;
    current = current.next;
  }
  current = token;
  while (++index < childEvents.length) {
    if (childEvents[index][0] === "exit" && childEvents[index - 1][0] === "enter" && childEvents[index][1].type === childEvents[index - 1][1].type && childEvents[index][1].start.line !== childEvents[index][1].end.line) {
      ok(current, "expected a current token");
      start = index + 1;
      breaks.push(start);
      current._tokenizer = undefined;
      current.previous = undefined;
      current = current.next;
    }
  }
  tokenizer.events = [];
  if (current) {
    current._tokenizer = undefined;
    current.previous = undefined;
    ok(!current.next, "expected no next token");
  } else {
    breaks.pop();
  }
  index = breaks.length;
  while (index--) {
    const slice = childEvents.slice(breaks[index], breaks[index + 1]);
    const start2 = startPositions.pop();
    ok(start2 !== undefined, "expected a start position when splicing");
    jumps.push([start2, start2 + slice.length - 1]);
    events.splice(start2, 2, slice);
  }
  jumps.reverse();
  index = -1;
  while (++index < jumps.length) {
    gaps[adjust + jumps[index][0]] = adjust + jumps[index][1];
    adjust += jumps[index][1] - jumps[index][0] - 1;
  }
  return gaps;
}

// node_modules/micromark-core-commonmark/dev/lib/content.js
var content2 = { resolve: resolveContent, tokenize: tokenizeContent };
var continuationConstruct = { partial: true, tokenize: tokenizeContinuation };
function resolveContent(events) {
  subtokenize(events);
  return events;
}
function tokenizeContent(effects, ok2) {
  let previous2;
  return chunkStart;
  function chunkStart(code) {
    ok(code !== codes.eof && !markdownLineEnding(code), "expected no eof or eol");
    effects.enter(types.content);
    previous2 = effects.enter(types.chunkContent, {
      contentType: constants.contentTypeContent
    });
    return chunkInside(code);
  }
  function chunkInside(code) {
    if (code === codes.eof) {
      return contentEnd(code);
    }
    if (markdownLineEnding(code)) {
      return effects.check(continuationConstruct, contentContinue, contentEnd)(code);
    }
    effects.consume(code);
    return chunkInside;
  }
  function contentEnd(code) {
    effects.exit(types.chunkContent);
    effects.exit(types.content);
    return ok2(code);
  }
  function contentContinue(code) {
    ok(markdownLineEnding(code), "expected eol");
    effects.consume(code);
    effects.exit(types.chunkContent);
    ok(previous2, "expected previous token");
    previous2.next = effects.enter(types.chunkContent, {
      contentType: constants.contentTypeContent,
      previous: previous2
    });
    previous2 = previous2.next;
    return chunkInside;
  }
}
function tokenizeContinuation(effects, ok2, nok) {
  const self = this;
  return startLookahead;
  function startLookahead(code) {
    ok(markdownLineEnding(code), "expected a line ending");
    effects.exit(types.chunkContent);
    effects.enter(types.lineEnding);
    effects.consume(code);
    effects.exit(types.lineEnding);
    return factorySpace(effects, prefixed, types.linePrefix);
  }
  function prefixed(code) {
    if (code === codes.eof || markdownLineEnding(code)) {
      return nok(code);
    }
    ok(self.parser.constructs.disable.null, "expected `disable.null` to be populated");
    const tail = self.events[self.events.length - 1];
    if (!self.parser.constructs.disable.null.includes("codeIndented") && tail && tail[1].type === types.linePrefix && tail[2].sliceSerialize(tail[1], true).length >= constants.tabSize) {
      return ok2(code);
    }
    return effects.interrupt(self.parser.constructs.flow, nok, ok2)(code);
  }
}
// node_modules/micromark-factory-destination/dev/index.js
function factoryDestination(effects, ok2, nok, type, literalType, literalMarkerType, rawType, stringType, max) {
  const limit = max || Number.POSITIVE_INFINITY;
  let balance = 0;
  return start;
  function start(code) {
    if (code === codes.lessThan) {
      effects.enter(type);
      effects.enter(literalType);
      effects.enter(literalMarkerType);
      effects.consume(code);
      effects.exit(literalMarkerType);
      return enclosedBefore;
    }
    if (code === codes.eof || code === codes.space || code === codes.rightParenthesis || asciiControl(code)) {
      return nok(code);
    }
    effects.enter(type);
    effects.enter(rawType);
    effects.enter(stringType);
    effects.enter(types.chunkString, { contentType: constants.contentTypeString });
    return raw(code);
  }
  function enclosedBefore(code) {
    if (code === codes.greaterThan) {
      effects.enter(literalMarkerType);
      effects.consume(code);
      effects.exit(literalMarkerType);
      effects.exit(literalType);
      effects.exit(type);
      return ok2;
    }
    effects.enter(stringType);
    effects.enter(types.chunkString, { contentType: constants.contentTypeString });
    return enclosed(code);
  }
  function enclosed(code) {
    if (code === codes.greaterThan) {
      effects.exit(types.chunkString);
      effects.exit(stringType);
      return enclosedBefore(code);
    }
    if (code === codes.eof || code === codes.lessThan || markdownLineEnding(code)) {
      return nok(code);
    }
    effects.consume(code);
    return code === codes.backslash ? enclosedEscape : enclosed;
  }
  function enclosedEscape(code) {
    if (code === codes.lessThan || code === codes.greaterThan || code === codes.backslash) {
      effects.consume(code);
      return enclosed;
    }
    return enclosed(code);
  }
  function raw(code) {
    if (!balance && (code === codes.eof || code === codes.rightParenthesis || markdownLineEndingOrSpace(code))) {
      effects.exit(types.chunkString);
      effects.exit(stringType);
      effects.exit(rawType);
      effects.exit(type);
      return ok2(code);
    }
    if (balance < limit && code === codes.leftParenthesis) {
      effects.consume(code);
      balance++;
      return raw;
    }
    if (code === codes.rightParenthesis) {
      effects.consume(code);
      balance--;
      return raw;
    }
    if (code === codes.eof || code === codes.space || code === codes.leftParenthesis || asciiControl(code)) {
      return nok(code);
    }
    effects.consume(code);
    return code === codes.backslash ? rawEscape : raw;
  }
  function rawEscape(code) {
    if (code === codes.leftParenthesis || code === codes.rightParenthesis || code === codes.backslash) {
      effects.consume(code);
      return raw;
    }
    return raw(code);
  }
}

// node_modules/micromark-factory-label/dev/index.js
function factoryLabel(effects, ok2, nok, type, markerType, stringType) {
  const self = this;
  let size = 0;
  let seen;
  return start;
  function start(code) {
    ok(code === codes.leftSquareBracket, "expected `[`");
    effects.enter(type);
    effects.enter(markerType);
    effects.consume(code);
    effects.exit(markerType);
    effects.enter(stringType);
    return atBreak;
  }
  function atBreak(code) {
    if (size > constants.linkReferenceSizeMax || code === codes.eof || code === codes.leftSquareBracket || code === codes.rightSquareBracket && !seen || code === codes.caret && !size && "_hiddenFootnoteSupport" in self.parser.constructs) {
      return nok(code);
    }
    if (code === codes.rightSquareBracket) {
      effects.exit(stringType);
      effects.enter(markerType);
      effects.consume(code);
      effects.exit(markerType);
      effects.exit(type);
      return ok2;
    }
    if (markdownLineEnding(code)) {
      effects.enter(types.lineEnding);
      effects.consume(code);
      effects.exit(types.lineEnding);
      return atBreak;
    }
    effects.enter(types.chunkString, { contentType: constants.contentTypeString });
    return labelInside(code);
  }
  function labelInside(code) {
    if (code === codes.eof || code === codes.leftSquareBracket || code === codes.rightSquareBracket || markdownLineEnding(code) || size++ > constants.linkReferenceSizeMax) {
      effects.exit(types.chunkString);
      return atBreak(code);
    }
    effects.consume(code);
    if (!seen)
      seen = !markdownSpace(code);
    return code === codes.backslash ? labelEscape : labelInside;
  }
  function labelEscape(code) {
    if (code === codes.leftSquareBracket || code === codes.backslash || code === codes.rightSquareBracket) {
      effects.consume(code);
      size++;
      return labelInside;
    }
    return labelInside(code);
  }
}

// node_modules/micromark-factory-title/dev/index.js
function factoryTitle(effects, ok2, nok, type, markerType, stringType) {
  let marker;
  return start;
  function start(code) {
    if (code === codes.quotationMark || code === codes.apostrophe || code === codes.leftParenthesis) {
      effects.enter(type);
      effects.enter(markerType);
      effects.consume(code);
      effects.exit(markerType);
      marker = code === codes.leftParenthesis ? codes.rightParenthesis : code;
      return begin;
    }
    return nok(code);
  }
  function begin(code) {
    if (code === marker) {
      effects.enter(markerType);
      effects.consume(code);
      effects.exit(markerType);
      effects.exit(type);
      return ok2;
    }
    effects.enter(stringType);
    return atBreak(code);
  }
  function atBreak(code) {
    if (code === marker) {
      effects.exit(stringType);
      return begin(marker);
    }
    if (code === codes.eof) {
      return nok(code);
    }
    if (markdownLineEnding(code)) {
      effects.enter(types.lineEnding);
      effects.consume(code);
      effects.exit(types.lineEnding);
      return factorySpace(effects, atBreak, types.linePrefix);
    }
    effects.enter(types.chunkString, { contentType: constants.contentTypeString });
    return inside(code);
  }
  function inside(code) {
    if (code === marker || code === codes.eof || markdownLineEnding(code)) {
      effects.exit(types.chunkString);
      return atBreak(code);
    }
    effects.consume(code);
    return code === codes.backslash ? escape : inside;
  }
  function escape(code) {
    if (code === marker || code === codes.backslash) {
      effects.consume(code);
      return inside;
    }
    return inside(code);
  }
}

// node_modules/micromark-factory-whitespace/dev/index.js
function factoryWhitespace(effects, ok2) {
  let seen;
  return start;
  function start(code) {
    if (markdownLineEnding(code)) {
      effects.enter(types.lineEnding);
      effects.consume(code);
      effects.exit(types.lineEnding);
      seen = true;
      return start;
    }
    if (markdownSpace(code)) {
      return factorySpace(effects, start, seen ? types.linePrefix : types.lineSuffix)(code);
    }
    return ok2(code);
  }
}

// node_modules/micromark-core-commonmark/dev/lib/definition.js
var definition = { name: "definition", tokenize: tokenizeDefinition };
var titleBefore = { partial: true, tokenize: tokenizeTitleBefore };
function tokenizeDefinition(effects, ok2, nok) {
  const self = this;
  let identifier;
  return start;
  function start(code) {
    effects.enter(types.definition);
    return before(code);
  }
  function before(code) {
    ok(code === codes.leftSquareBracket, "expected `[`");
    return factoryLabel.call(self, effects, labelAfter, nok, types.definitionLabel, types.definitionLabelMarker, types.definitionLabelString)(code);
  }
  function labelAfter(code) {
    identifier = normalizeIdentifier(self.sliceSerialize(self.events[self.events.length - 1][1]).slice(1, -1));
    if (code === codes.colon) {
      effects.enter(types.definitionMarker);
      effects.consume(code);
      effects.exit(types.definitionMarker);
      return markerAfter;
    }
    return nok(code);
  }
  function markerAfter(code) {
    return markdownLineEndingOrSpace(code) ? factoryWhitespace(effects, destinationBefore)(code) : destinationBefore(code);
  }
  function destinationBefore(code) {
    return factoryDestination(effects, destinationAfter, nok, types.definitionDestination, types.definitionDestinationLiteral, types.definitionDestinationLiteralMarker, types.definitionDestinationRaw, types.definitionDestinationString)(code);
  }
  function destinationAfter(code) {
    return effects.attempt(titleBefore, after, after)(code);
  }
  function after(code) {
    return markdownSpace(code) ? factorySpace(effects, afterWhitespace, types.whitespace)(code) : afterWhitespace(code);
  }
  function afterWhitespace(code) {
    if (code === codes.eof || markdownLineEnding(code)) {
      effects.exit(types.definition);
      self.parser.defined.push(identifier);
      return ok2(code);
    }
    return nok(code);
  }
}
function tokenizeTitleBefore(effects, ok2, nok) {
  return titleBefore2;
  function titleBefore2(code) {
    return markdownLineEndingOrSpace(code) ? factoryWhitespace(effects, beforeMarker)(code) : nok(code);
  }
  function beforeMarker(code) {
    return factoryTitle(effects, titleAfter, nok, types.definitionTitle, types.definitionTitleMarker, types.definitionTitleString)(code);
  }
  function titleAfter(code) {
    return markdownSpace(code) ? factorySpace(effects, titleAfterOptionalWhitespace, types.whitespace)(code) : titleAfterOptionalWhitespace(code);
  }
  function titleAfterOptionalWhitespace(code) {
    return code === codes.eof || markdownLineEnding(code) ? ok2(code) : nok(code);
  }
}
// node_modules/micromark-core-commonmark/dev/lib/hard-break-escape.js
var hardBreakEscape = {
  name: "hardBreakEscape",
  tokenize: tokenizeHardBreakEscape
};
function tokenizeHardBreakEscape(effects, ok2, nok) {
  return start;
  function start(code) {
    ok(code === codes.backslash, "expected `\\`");
    effects.enter(types.hardBreakEscape);
    effects.consume(code);
    return after;
  }
  function after(code) {
    if (markdownLineEnding(code)) {
      effects.exit(types.hardBreakEscape);
      return ok2(code);
    }
    return nok(code);
  }
}
// node_modules/micromark-core-commonmark/dev/lib/heading-atx.js
var headingAtx = {
  name: "headingAtx",
  resolve: resolveHeadingAtx,
  tokenize: tokenizeHeadingAtx
};
function resolveHeadingAtx(events, context) {
  let contentEnd = events.length - 2;
  let contentStart = 3;
  let content3;
  let text;
  if (events[contentStart][1].type === types.whitespace) {
    contentStart += 2;
  }
  if (contentEnd - 2 > contentStart && events[contentEnd][1].type === types.whitespace) {
    contentEnd -= 2;
  }
  if (events[contentEnd][1].type === types.atxHeadingSequence && (contentStart === contentEnd - 1 || contentEnd - 4 > contentStart && events[contentEnd - 2][1].type === types.whitespace)) {
    contentEnd -= contentStart + 1 === contentEnd ? 2 : 4;
  }
  if (contentEnd > contentStart) {
    content3 = {
      type: types.atxHeadingText,
      start: events[contentStart][1].start,
      end: events[contentEnd][1].end
    };
    text = {
      type: types.chunkText,
      start: events[contentStart][1].start,
      end: events[contentEnd][1].end,
      contentType: constants.contentTypeText
    };
    splice(events, contentStart, contentEnd - contentStart + 1, [
      ["enter", content3, context],
      ["enter", text, context],
      ["exit", text, context],
      ["exit", content3, context]
    ]);
  }
  return events;
}
function tokenizeHeadingAtx(effects, ok2, nok) {
  let size = 0;
  return start;
  function start(code) {
    effects.enter(types.atxHeading);
    return before(code);
  }
  function before(code) {
    ok(code === codes.numberSign, "expected `#`");
    effects.enter(types.atxHeadingSequence);
    return sequenceOpen(code);
  }
  function sequenceOpen(code) {
    if (code === codes.numberSign && size++ < constants.atxHeadingOpeningFenceSizeMax) {
      effects.consume(code);
      return sequenceOpen;
    }
    if (code === codes.eof || markdownLineEndingOrSpace(code)) {
      effects.exit(types.atxHeadingSequence);
      return atBreak(code);
    }
    return nok(code);
  }
  function atBreak(code) {
    if (code === codes.numberSign) {
      effects.enter(types.atxHeadingSequence);
      return sequenceFurther(code);
    }
    if (code === codes.eof || markdownLineEnding(code)) {
      effects.exit(types.atxHeading);
      return ok2(code);
    }
    if (markdownSpace(code)) {
      return factorySpace(effects, atBreak, types.whitespace)(code);
    }
    effects.enter(types.atxHeadingText);
    return data(code);
  }
  function sequenceFurther(code) {
    if (code === codes.numberSign) {
      effects.consume(code);
      return sequenceFurther;
    }
    effects.exit(types.atxHeadingSequence);
    return atBreak(code);
  }
  function data(code) {
    if (code === codes.eof || code === codes.numberSign || markdownLineEndingOrSpace(code)) {
      effects.exit(types.atxHeadingText);
      return atBreak(code);
    }
    effects.consume(code);
    return data;
  }
}
// node_modules/micromark-util-html-tag-name/index.js
var htmlBlockNames = [
  "address",
  "article",
  "aside",
  "base",
  "basefont",
  "blockquote",
  "body",
  "caption",
  "center",
  "col",
  "colgroup",
  "dd",
  "details",
  "dialog",
  "dir",
  "div",
  "dl",
  "dt",
  "fieldset",
  "figcaption",
  "figure",
  "footer",
  "form",
  "frame",
  "frameset",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "head",
  "header",
  "hr",
  "html",
  "iframe",
  "legend",
  "li",
  "link",
  "main",
  "menu",
  "menuitem",
  "nav",
  "noframes",
  "ol",
  "optgroup",
  "option",
  "p",
  "param",
  "search",
  "section",
  "summary",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "title",
  "tr",
  "track",
  "ul"
];
var htmlRawNames = ["pre", "script", "style", "textarea"];

// node_modules/micromark-core-commonmark/dev/lib/html-flow.js
var htmlFlow = {
  concrete: true,
  name: "htmlFlow",
  resolveTo: resolveToHtmlFlow,
  tokenize: tokenizeHtmlFlow
};
var blankLineBefore = { partial: true, tokenize: tokenizeBlankLineBefore };
var nonLazyContinuationStart = {
  partial: true,
  tokenize: tokenizeNonLazyContinuationStart
};
function resolveToHtmlFlow(events) {
  let index = events.length;
  while (index--) {
    if (events[index][0] === "enter" && events[index][1].type === types.htmlFlow) {
      break;
    }
  }
  if (index > 1 && events[index - 2][1].type === types.linePrefix) {
    events[index][1].start = events[index - 2][1].start;
    events[index + 1][1].start = events[index - 2][1].start;
    events.splice(index - 2, 2);
  }
  return events;
}
function tokenizeHtmlFlow(effects, ok2, nok) {
  const self = this;
  let marker;
  let closingTag;
  let buffer;
  let index;
  let markerB;
  return start;
  function start(code) {
    return before(code);
  }
  function before(code) {
    ok(code === codes.lessThan, "expected `<`");
    effects.enter(types.htmlFlow);
    effects.enter(types.htmlFlowData);
    effects.consume(code);
    return open;
  }
  function open(code) {
    if (code === codes.exclamationMark) {
      effects.consume(code);
      return declarationOpen;
    }
    if (code === codes.slash) {
      effects.consume(code);
      closingTag = true;
      return tagCloseStart;
    }
    if (code === codes.questionMark) {
      effects.consume(code);
      marker = constants.htmlInstruction;
      return self.interrupt ? ok2 : continuationDeclarationInside;
    }
    if (asciiAlpha(code)) {
      ok(code !== null);
      effects.consume(code);
      buffer = String.fromCharCode(code);
      return tagName;
    }
    return nok(code);
  }
  function declarationOpen(code) {
    if (code === codes.dash) {
      effects.consume(code);
      marker = constants.htmlComment;
      return commentOpenInside;
    }
    if (code === codes.leftSquareBracket) {
      effects.consume(code);
      marker = constants.htmlCdata;
      index = 0;
      return cdataOpenInside;
    }
    if (asciiAlpha(code)) {
      effects.consume(code);
      marker = constants.htmlDeclaration;
      return self.interrupt ? ok2 : continuationDeclarationInside;
    }
    return nok(code);
  }
  function commentOpenInside(code) {
    if (code === codes.dash) {
      effects.consume(code);
      return self.interrupt ? ok2 : continuationDeclarationInside;
    }
    return nok(code);
  }
  function cdataOpenInside(code) {
    const value = constants.cdataOpeningString;
    if (code === value.charCodeAt(index++)) {
      effects.consume(code);
      if (index === value.length) {
        return self.interrupt ? ok2 : continuation;
      }
      return cdataOpenInside;
    }
    return nok(code);
  }
  function tagCloseStart(code) {
    if (asciiAlpha(code)) {
      ok(code !== null);
      effects.consume(code);
      buffer = String.fromCharCode(code);
      return tagName;
    }
    return nok(code);
  }
  function tagName(code) {
    if (code === codes.eof || code === codes.slash || code === codes.greaterThan || markdownLineEndingOrSpace(code)) {
      const slash = code === codes.slash;
      const name = buffer.toLowerCase();
      if (!slash && !closingTag && htmlRawNames.includes(name)) {
        marker = constants.htmlRaw;
        return self.interrupt ? ok2(code) : continuation(code);
      }
      if (htmlBlockNames.includes(buffer.toLowerCase())) {
        marker = constants.htmlBasic;
        if (slash) {
          effects.consume(code);
          return basicSelfClosing;
        }
        return self.interrupt ? ok2(code) : continuation(code);
      }
      marker = constants.htmlComplete;
      return self.interrupt && !self.parser.lazy[self.now().line] ? nok(code) : closingTag ? completeClosingTagAfter(code) : completeAttributeNameBefore(code);
    }
    if (code === codes.dash || asciiAlphanumeric(code)) {
      effects.consume(code);
      buffer += String.fromCharCode(code);
      return tagName;
    }
    return nok(code);
  }
  function basicSelfClosing(code) {
    if (code === codes.greaterThan) {
      effects.consume(code);
      return self.interrupt ? ok2 : continuation;
    }
    return nok(code);
  }
  function completeClosingTagAfter(code) {
    if (markdownSpace(code)) {
      effects.consume(code);
      return completeClosingTagAfter;
    }
    return completeEnd(code);
  }
  function completeAttributeNameBefore(code) {
    if (code === codes.slash) {
      effects.consume(code);
      return completeEnd;
    }
    if (code === codes.colon || code === codes.underscore || asciiAlpha(code)) {
      effects.consume(code);
      return completeAttributeName;
    }
    if (markdownSpace(code)) {
      effects.consume(code);
      return completeAttributeNameBefore;
    }
    return completeEnd(code);
  }
  function completeAttributeName(code) {
    if (code === codes.dash || code === codes.dot || code === codes.colon || code === codes.underscore || asciiAlphanumeric(code)) {
      effects.consume(code);
      return completeAttributeName;
    }
    return completeAttributeNameAfter(code);
  }
  function completeAttributeNameAfter(code) {
    if (code === codes.equalsTo) {
      effects.consume(code);
      return completeAttributeValueBefore;
    }
    if (markdownSpace(code)) {
      effects.consume(code);
      return completeAttributeNameAfter;
    }
    return completeAttributeNameBefore(code);
  }
  function completeAttributeValueBefore(code) {
    if (code === codes.eof || code === codes.lessThan || code === codes.equalsTo || code === codes.greaterThan || code === codes.graveAccent) {
      return nok(code);
    }
    if (code === codes.quotationMark || code === codes.apostrophe) {
      effects.consume(code);
      markerB = code;
      return completeAttributeValueQuoted;
    }
    if (markdownSpace(code)) {
      effects.consume(code);
      return completeAttributeValueBefore;
    }
    return completeAttributeValueUnquoted(code);
  }
  function completeAttributeValueQuoted(code) {
    if (code === markerB) {
      effects.consume(code);
      markerB = null;
      return completeAttributeValueQuotedAfter;
    }
    if (code === codes.eof || markdownLineEnding(code)) {
      return nok(code);
    }
    effects.consume(code);
    return completeAttributeValueQuoted;
  }
  function completeAttributeValueUnquoted(code) {
    if (code === codes.eof || code === codes.quotationMark || code === codes.apostrophe || code === codes.slash || code === codes.lessThan || code === codes.equalsTo || code === codes.greaterThan || code === codes.graveAccent || markdownLineEndingOrSpace(code)) {
      return completeAttributeNameAfter(code);
    }
    effects.consume(code);
    return completeAttributeValueUnquoted;
  }
  function completeAttributeValueQuotedAfter(code) {
    if (code === codes.slash || code === codes.greaterThan || markdownSpace(code)) {
      return completeAttributeNameBefore(code);
    }
    return nok(code);
  }
  function completeEnd(code) {
    if (code === codes.greaterThan) {
      effects.consume(code);
      return completeAfter;
    }
    return nok(code);
  }
  function completeAfter(code) {
    if (code === codes.eof || markdownLineEnding(code)) {
      return continuation(code);
    }
    if (markdownSpace(code)) {
      effects.consume(code);
      return completeAfter;
    }
    return nok(code);
  }
  function continuation(code) {
    if (code === codes.dash && marker === constants.htmlComment) {
      effects.consume(code);
      return continuationCommentInside;
    }
    if (code === codes.lessThan && marker === constants.htmlRaw) {
      effects.consume(code);
      return continuationRawTagOpen;
    }
    if (code === codes.greaterThan && marker === constants.htmlDeclaration) {
      effects.consume(code);
      return continuationClose;
    }
    if (code === codes.questionMark && marker === constants.htmlInstruction) {
      effects.consume(code);
      return continuationDeclarationInside;
    }
    if (code === codes.rightSquareBracket && marker === constants.htmlCdata) {
      effects.consume(code);
      return continuationCdataInside;
    }
    if (markdownLineEnding(code) && (marker === constants.htmlBasic || marker === constants.htmlComplete)) {
      effects.exit(types.htmlFlowData);
      return effects.check(blankLineBefore, continuationAfter, continuationStart)(code);
    }
    if (code === codes.eof || markdownLineEnding(code)) {
      effects.exit(types.htmlFlowData);
      return continuationStart(code);
    }
    effects.consume(code);
    return continuation;
  }
  function continuationStart(code) {
    return effects.check(nonLazyContinuationStart, continuationStartNonLazy, continuationAfter)(code);
  }
  function continuationStartNonLazy(code) {
    ok(markdownLineEnding(code));
    effects.enter(types.lineEnding);
    effects.consume(code);
    effects.exit(types.lineEnding);
    return continuationBefore;
  }
  function continuationBefore(code) {
    if (code === codes.eof || markdownLineEnding(code)) {
      return continuationStart(code);
    }
    effects.enter(types.htmlFlowData);
    return continuation(code);
  }
  function continuationCommentInside(code) {
    if (code === codes.dash) {
      effects.consume(code);
      return continuationDeclarationInside;
    }
    return continuation(code);
  }
  function continuationRawTagOpen(code) {
    if (code === codes.slash) {
      effects.consume(code);
      buffer = "";
      return continuationRawEndTag;
    }
    return continuation(code);
  }
  function continuationRawEndTag(code) {
    if (code === codes.greaterThan) {
      const name = buffer.toLowerCase();
      if (htmlRawNames.includes(name)) {
        effects.consume(code);
        return continuationClose;
      }
      return continuation(code);
    }
    if (asciiAlpha(code) && buffer.length < constants.htmlRawSizeMax) {
      ok(code !== null);
      effects.consume(code);
      buffer += String.fromCharCode(code);
      return continuationRawEndTag;
    }
    return continuation(code);
  }
  function continuationCdataInside(code) {
    if (code === codes.rightSquareBracket) {
      effects.consume(code);
      return continuationDeclarationInside;
    }
    return continuation(code);
  }
  function continuationDeclarationInside(code) {
    if (code === codes.greaterThan) {
      effects.consume(code);
      return continuationClose;
    }
    if (code === codes.dash && marker === constants.htmlComment) {
      effects.consume(code);
      return continuationDeclarationInside;
    }
    return continuation(code);
  }
  function continuationClose(code) {
    if (code === codes.eof || markdownLineEnding(code)) {
      effects.exit(types.htmlFlowData);
      return continuationAfter(code);
    }
    effects.consume(code);
    return continuationClose;
  }
  function continuationAfter(code) {
    effects.exit(types.htmlFlow);
    return ok2(code);
  }
}
function tokenizeNonLazyContinuationStart(effects, ok2, nok) {
  const self = this;
  return start;
  function start(code) {
    if (markdownLineEnding(code)) {
      effects.enter(types.lineEnding);
      effects.consume(code);
      effects.exit(types.lineEnding);
      return after;
    }
    return nok(code);
  }
  function after(code) {
    return self.parser.lazy[self.now().line] ? nok(code) : ok2(code);
  }
}
function tokenizeBlankLineBefore(effects, ok2, nok) {
  return start;
  function start(code) {
    ok(markdownLineEnding(code), "expected a line ending");
    effects.enter(types.lineEnding);
    effects.consume(code);
    effects.exit(types.lineEnding);
    return effects.attempt(blankLine, ok2, nok);
  }
}
// node_modules/micromark-core-commonmark/dev/lib/html-text.js
var htmlText = { name: "htmlText", tokenize: tokenizeHtmlText };
function tokenizeHtmlText(effects, ok2, nok) {
  const self = this;
  let marker;
  let index;
  let returnState;
  return start;
  function start(code) {
    ok(code === codes.lessThan, "expected `<`");
    effects.enter(types.htmlText);
    effects.enter(types.htmlTextData);
    effects.consume(code);
    return open;
  }
  function open(code) {
    if (code === codes.exclamationMark) {
      effects.consume(code);
      return declarationOpen;
    }
    if (code === codes.slash) {
      effects.consume(code);
      return tagCloseStart;
    }
    if (code === codes.questionMark) {
      effects.consume(code);
      return instruction;
    }
    if (asciiAlpha(code)) {
      effects.consume(code);
      return tagOpen;
    }
    return nok(code);
  }
  function declarationOpen(code) {
    if (code === codes.dash) {
      effects.consume(code);
      return commentOpenInside;
    }
    if (code === codes.leftSquareBracket) {
      effects.consume(code);
      index = 0;
      return cdataOpenInside;
    }
    if (asciiAlpha(code)) {
      effects.consume(code);
      return declaration;
    }
    return nok(code);
  }
  function commentOpenInside(code) {
    if (code === codes.dash) {
      effects.consume(code);
      return commentEnd;
    }
    return nok(code);
  }
  function comment(code) {
    if (code === codes.eof) {
      return nok(code);
    }
    if (code === codes.dash) {
      effects.consume(code);
      return commentClose;
    }
    if (markdownLineEnding(code)) {
      returnState = comment;
      return lineEndingBefore(code);
    }
    effects.consume(code);
    return comment;
  }
  function commentClose(code) {
    if (code === codes.dash) {
      effects.consume(code);
      return commentEnd;
    }
    return comment(code);
  }
  function commentEnd(code) {
    return code === codes.greaterThan ? end(code) : code === codes.dash ? commentClose(code) : comment(code);
  }
  function cdataOpenInside(code) {
    const value = constants.cdataOpeningString;
    if (code === value.charCodeAt(index++)) {
      effects.consume(code);
      return index === value.length ? cdata : cdataOpenInside;
    }
    return nok(code);
  }
  function cdata(code) {
    if (code === codes.eof) {
      return nok(code);
    }
    if (code === codes.rightSquareBracket) {
      effects.consume(code);
      return cdataClose;
    }
    if (markdownLineEnding(code)) {
      returnState = cdata;
      return lineEndingBefore(code);
    }
    effects.consume(code);
    return cdata;
  }
  function cdataClose(code) {
    if (code === codes.rightSquareBracket) {
      effects.consume(code);
      return cdataEnd;
    }
    return cdata(code);
  }
  function cdataEnd(code) {
    if (code === codes.greaterThan) {
      return end(code);
    }
    if (code === codes.rightSquareBracket) {
      effects.consume(code);
      return cdataEnd;
    }
    return cdata(code);
  }
  function declaration(code) {
    if (code === codes.eof || code === codes.greaterThan) {
      return end(code);
    }
    if (markdownLineEnding(code)) {
      returnState = declaration;
      return lineEndingBefore(code);
    }
    effects.consume(code);
    return declaration;
  }
  function instruction(code) {
    if (code === codes.eof) {
      return nok(code);
    }
    if (code === codes.questionMark) {
      effects.consume(code);
      return instructionClose;
    }
    if (markdownLineEnding(code)) {
      returnState = instruction;
      return lineEndingBefore(code);
    }
    effects.consume(code);
    return instruction;
  }
  function instructionClose(code) {
    return code === codes.greaterThan ? end(code) : instruction(code);
  }
  function tagCloseStart(code) {
    if (asciiAlpha(code)) {
      effects.consume(code);
      return tagClose;
    }
    return nok(code);
  }
  function tagClose(code) {
    if (code === codes.dash || asciiAlphanumeric(code)) {
      effects.consume(code);
      return tagClose;
    }
    return tagCloseBetween(code);
  }
  function tagCloseBetween(code) {
    if (markdownLineEnding(code)) {
      returnState = tagCloseBetween;
      return lineEndingBefore(code);
    }
    if (markdownSpace(code)) {
      effects.consume(code);
      return tagCloseBetween;
    }
    return end(code);
  }
  function tagOpen(code) {
    if (code === codes.dash || asciiAlphanumeric(code)) {
      effects.consume(code);
      return tagOpen;
    }
    if (code === codes.slash || code === codes.greaterThan || markdownLineEndingOrSpace(code)) {
      return tagOpenBetween(code);
    }
    return nok(code);
  }
  function tagOpenBetween(code) {
    if (code === codes.slash) {
      effects.consume(code);
      return end;
    }
    if (code === codes.colon || code === codes.underscore || asciiAlpha(code)) {
      effects.consume(code);
      return tagOpenAttributeName;
    }
    if (markdownLineEnding(code)) {
      returnState = tagOpenBetween;
      return lineEndingBefore(code);
    }
    if (markdownSpace(code)) {
      effects.consume(code);
      return tagOpenBetween;
    }
    return end(code);
  }
  function tagOpenAttributeName(code) {
    if (code === codes.dash || code === codes.dot || code === codes.colon || code === codes.underscore || asciiAlphanumeric(code)) {
      effects.consume(code);
      return tagOpenAttributeName;
    }
    return tagOpenAttributeNameAfter(code);
  }
  function tagOpenAttributeNameAfter(code) {
    if (code === codes.equalsTo) {
      effects.consume(code);
      return tagOpenAttributeValueBefore;
    }
    if (markdownLineEnding(code)) {
      returnState = tagOpenAttributeNameAfter;
      return lineEndingBefore(code);
    }
    if (markdownSpace(code)) {
      effects.consume(code);
      return tagOpenAttributeNameAfter;
    }
    return tagOpenBetween(code);
  }
  function tagOpenAttributeValueBefore(code) {
    if (code === codes.eof || code === codes.lessThan || code === codes.equalsTo || code === codes.greaterThan || code === codes.graveAccent) {
      return nok(code);
    }
    if (code === codes.quotationMark || code === codes.apostrophe) {
      effects.consume(code);
      marker = code;
      return tagOpenAttributeValueQuoted;
    }
    if (markdownLineEnding(code)) {
      returnState = tagOpenAttributeValueBefore;
      return lineEndingBefore(code);
    }
    if (markdownSpace(code)) {
      effects.consume(code);
      return tagOpenAttributeValueBefore;
    }
    effects.consume(code);
    return tagOpenAttributeValueUnquoted;
  }
  function tagOpenAttributeValueQuoted(code) {
    if (code === marker) {
      effects.consume(code);
      marker = undefined;
      return tagOpenAttributeValueQuotedAfter;
    }
    if (code === codes.eof) {
      return nok(code);
    }
    if (markdownLineEnding(code)) {
      returnState = tagOpenAttributeValueQuoted;
      return lineEndingBefore(code);
    }
    effects.consume(code);
    return tagOpenAttributeValueQuoted;
  }
  function tagOpenAttributeValueUnquoted(code) {
    if (code === codes.eof || code === codes.quotationMark || code === codes.apostrophe || code === codes.lessThan || code === codes.equalsTo || code === codes.graveAccent) {
      return nok(code);
    }
    if (code === codes.slash || code === codes.greaterThan || markdownLineEndingOrSpace(code)) {
      return tagOpenBetween(code);
    }
    effects.consume(code);
    return tagOpenAttributeValueUnquoted;
  }
  function tagOpenAttributeValueQuotedAfter(code) {
    if (code === codes.slash || code === codes.greaterThan || markdownLineEndingOrSpace(code)) {
      return tagOpenBetween(code);
    }
    return nok(code);
  }
  function end(code) {
    if (code === codes.greaterThan) {
      effects.consume(code);
      effects.exit(types.htmlTextData);
      effects.exit(types.htmlText);
      return ok2;
    }
    return nok(code);
  }
  function lineEndingBefore(code) {
    ok(returnState, "expected return state");
    ok(markdownLineEnding(code), "expected eol");
    effects.exit(types.htmlTextData);
    effects.enter(types.lineEnding);
    effects.consume(code);
    effects.exit(types.lineEnding);
    return lineEndingAfter;
  }
  function lineEndingAfter(code) {
    ok(self.parser.constructs.disable.null, "expected `disable.null` to be populated");
    return markdownSpace(code) ? factorySpace(effects, lineEndingAfterPrefix, types.linePrefix, self.parser.constructs.disable.null.includes("codeIndented") ? undefined : constants.tabSize)(code) : lineEndingAfterPrefix(code);
  }
  function lineEndingAfterPrefix(code) {
    effects.enter(types.htmlTextData);
    return returnState(code);
  }
}
// node_modules/micromark-core-commonmark/dev/lib/label-end.js
var labelEnd = {
  name: "labelEnd",
  resolveAll: resolveAllLabelEnd,
  resolveTo: resolveToLabelEnd,
  tokenize: tokenizeLabelEnd
};
var resourceConstruct = { tokenize: tokenizeResource };
var referenceFullConstruct = { tokenize: tokenizeReferenceFull };
var referenceCollapsedConstruct = { tokenize: tokenizeReferenceCollapsed };
function resolveAllLabelEnd(events) {
  let index = -1;
  const newEvents = [];
  while (++index < events.length) {
    const token = events[index][1];
    newEvents.push(events[index]);
    if (token.type === types.labelImage || token.type === types.labelLink || token.type === types.labelEnd) {
      const offset = token.type === types.labelImage ? 4 : 2;
      token.type = types.data;
      index += offset;
    }
  }
  if (events.length !== newEvents.length) {
    splice(events, 0, events.length, newEvents);
  }
  return events;
}
function resolveToLabelEnd(events, context) {
  let index = events.length;
  let offset = 0;
  let token;
  let open;
  let close;
  let media;
  while (index--) {
    token = events[index][1];
    if (open) {
      if (token.type === types.link || token.type === types.labelLink && token._inactive) {
        break;
      }
      if (events[index][0] === "enter" && token.type === types.labelLink) {
        token._inactive = true;
      }
    } else if (close) {
      if (events[index][0] === "enter" && (token.type === types.labelImage || token.type === types.labelLink) && !token._balanced) {
        open = index;
        if (token.type !== types.labelLink) {
          offset = 2;
          break;
        }
      }
    } else if (token.type === types.labelEnd) {
      close = index;
    }
  }
  ok(open !== undefined, "`open` is supposed to be found");
  ok(close !== undefined, "`close` is supposed to be found");
  const group = {
    type: events[open][1].type === types.labelLink ? types.link : types.image,
    start: { ...events[open][1].start },
    end: { ...events[events.length - 1][1].end }
  };
  const label = {
    type: types.label,
    start: { ...events[open][1].start },
    end: { ...events[close][1].end }
  };
  const text = {
    type: types.labelText,
    start: { ...events[open + offset + 2][1].end },
    end: { ...events[close - 2][1].start }
  };
  media = [
    ["enter", group, context],
    ["enter", label, context]
  ];
  media = push(media, events.slice(open + 1, open + offset + 3));
  media = push(media, [["enter", text, context]]);
  ok(context.parser.constructs.insideSpan.null, "expected `insideSpan.null` to be populated");
  media = push(media, resolveAll(context.parser.constructs.insideSpan.null, events.slice(open + offset + 4, close - 3), context));
  media = push(media, [
    ["exit", text, context],
    events[close - 2],
    events[close - 1],
    ["exit", label, context]
  ]);
  media = push(media, events.slice(close + 1));
  media = push(media, [["exit", group, context]]);
  splice(events, open, events.length, media);
  return events;
}
function tokenizeLabelEnd(effects, ok2, nok) {
  const self = this;
  let index = self.events.length;
  let labelStart;
  let defined;
  while (index--) {
    if ((self.events[index][1].type === types.labelImage || self.events[index][1].type === types.labelLink) && !self.events[index][1]._balanced) {
      labelStart = self.events[index][1];
      break;
    }
  }
  return start;
  function start(code) {
    ok(code === codes.rightSquareBracket, "expected `]`");
    if (!labelStart) {
      return nok(code);
    }
    if (labelStart._inactive) {
      return labelEndNok(code);
    }
    defined = self.parser.defined.includes(normalizeIdentifier(self.sliceSerialize({ start: labelStart.end, end: self.now() })));
    effects.enter(types.labelEnd);
    effects.enter(types.labelMarker);
    effects.consume(code);
    effects.exit(types.labelMarker);
    effects.exit(types.labelEnd);
    return after;
  }
  function after(code) {
    if (code === codes.leftParenthesis) {
      return effects.attempt(resourceConstruct, labelEndOk, defined ? labelEndOk : labelEndNok)(code);
    }
    if (code === codes.leftSquareBracket) {
      return effects.attempt(referenceFullConstruct, labelEndOk, defined ? referenceNotFull : labelEndNok)(code);
    }
    return defined ? labelEndOk(code) : labelEndNok(code);
  }
  function referenceNotFull(code) {
    return effects.attempt(referenceCollapsedConstruct, labelEndOk, labelEndNok)(code);
  }
  function labelEndOk(code) {
    return ok2(code);
  }
  function labelEndNok(code) {
    labelStart._balanced = true;
    return nok(code);
  }
}
function tokenizeResource(effects, ok2, nok) {
  return resourceStart;
  function resourceStart(code) {
    ok(code === codes.leftParenthesis, "expected left paren");
    effects.enter(types.resource);
    effects.enter(types.resourceMarker);
    effects.consume(code);
    effects.exit(types.resourceMarker);
    return resourceBefore;
  }
  function resourceBefore(code) {
    return markdownLineEndingOrSpace(code) ? factoryWhitespace(effects, resourceOpen)(code) : resourceOpen(code);
  }
  function resourceOpen(code) {
    if (code === codes.rightParenthesis) {
      return resourceEnd(code);
    }
    return factoryDestination(effects, resourceDestinationAfter, resourceDestinationMissing, types.resourceDestination, types.resourceDestinationLiteral, types.resourceDestinationLiteralMarker, types.resourceDestinationRaw, types.resourceDestinationString, constants.linkResourceDestinationBalanceMax)(code);
  }
  function resourceDestinationAfter(code) {
    return markdownLineEndingOrSpace(code) ? factoryWhitespace(effects, resourceBetween)(code) : resourceEnd(code);
  }
  function resourceDestinationMissing(code) {
    return nok(code);
  }
  function resourceBetween(code) {
    if (code === codes.quotationMark || code === codes.apostrophe || code === codes.leftParenthesis) {
      return factoryTitle(effects, resourceTitleAfter, nok, types.resourceTitle, types.resourceTitleMarker, types.resourceTitleString)(code);
    }
    return resourceEnd(code);
  }
  function resourceTitleAfter(code) {
    return markdownLineEndingOrSpace(code) ? factoryWhitespace(effects, resourceEnd)(code) : resourceEnd(code);
  }
  function resourceEnd(code) {
    if (code === codes.rightParenthesis) {
      effects.enter(types.resourceMarker);
      effects.consume(code);
      effects.exit(types.resourceMarker);
      effects.exit(types.resource);
      return ok2;
    }
    return nok(code);
  }
}
function tokenizeReferenceFull(effects, ok2, nok) {
  const self = this;
  return referenceFull;
  function referenceFull(code) {
    ok(code === codes.leftSquareBracket, "expected left bracket");
    return factoryLabel.call(self, effects, referenceFullAfter, referenceFullMissing, types.reference, types.referenceMarker, types.referenceString)(code);
  }
  function referenceFullAfter(code) {
    return self.parser.defined.includes(normalizeIdentifier(self.sliceSerialize(self.events[self.events.length - 1][1]).slice(1, -1))) ? ok2(code) : nok(code);
  }
  function referenceFullMissing(code) {
    return nok(code);
  }
}
function tokenizeReferenceCollapsed(effects, ok2, nok) {
  return referenceCollapsedStart;
  function referenceCollapsedStart(code) {
    ok(code === codes.leftSquareBracket, "expected left bracket");
    effects.enter(types.reference);
    effects.enter(types.referenceMarker);
    effects.consume(code);
    effects.exit(types.referenceMarker);
    return referenceCollapsedOpen;
  }
  function referenceCollapsedOpen(code) {
    if (code === codes.rightSquareBracket) {
      effects.enter(types.referenceMarker);
      effects.consume(code);
      effects.exit(types.referenceMarker);
      effects.exit(types.reference);
      return ok2;
    }
    return nok(code);
  }
}
// node_modules/micromark-core-commonmark/dev/lib/label-start-image.js
var labelStartImage = {
  name: "labelStartImage",
  resolveAll: labelEnd.resolveAll,
  tokenize: tokenizeLabelStartImage
};
function tokenizeLabelStartImage(effects, ok2, nok) {
  const self = this;
  return start;
  function start(code) {
    ok(code === codes.exclamationMark, "expected `!`");
    effects.enter(types.labelImage);
    effects.enter(types.labelImageMarker);
    effects.consume(code);
    effects.exit(types.labelImageMarker);
    return open;
  }
  function open(code) {
    if (code === codes.leftSquareBracket) {
      effects.enter(types.labelMarker);
      effects.consume(code);
      effects.exit(types.labelMarker);
      effects.exit(types.labelImage);
      return after;
    }
    return nok(code);
  }
  function after(code) {
    return code === codes.caret && "_hiddenFootnoteSupport" in self.parser.constructs ? nok(code) : ok2(code);
  }
}
// node_modules/micromark-core-commonmark/dev/lib/label-start-link.js
var labelStartLink = {
  name: "labelStartLink",
  resolveAll: labelEnd.resolveAll,
  tokenize: tokenizeLabelStartLink
};
function tokenizeLabelStartLink(effects, ok2, nok) {
  const self = this;
  return start;
  function start(code) {
    ok(code === codes.leftSquareBracket, "expected `[`");
    effects.enter(types.labelLink);
    effects.enter(types.labelMarker);
    effects.consume(code);
    effects.exit(types.labelMarker);
    effects.exit(types.labelLink);
    return after;
  }
  function after(code) {
    return code === codes.caret && "_hiddenFootnoteSupport" in self.parser.constructs ? nok(code) : ok2(code);
  }
}
// node_modules/micromark-core-commonmark/dev/lib/line-ending.js
var lineEnding = { name: "lineEnding", tokenize: tokenizeLineEnding };
function tokenizeLineEnding(effects, ok2) {
  return start;
  function start(code) {
    ok(markdownLineEnding(code), "expected eol");
    effects.enter(types.lineEnding);
    effects.consume(code);
    effects.exit(types.lineEnding);
    return factorySpace(effects, ok2, types.linePrefix);
  }
}
// node_modules/micromark-core-commonmark/dev/lib/thematic-break.js
var thematicBreak = {
  name: "thematicBreak",
  tokenize: tokenizeThematicBreak
};
function tokenizeThematicBreak(effects, ok2, nok) {
  let size = 0;
  let marker;
  return start;
  function start(code) {
    effects.enter(types.thematicBreak);
    return before(code);
  }
  function before(code) {
    ok(code === codes.asterisk || code === codes.dash || code === codes.underscore, "expected `*`, `-`, or `_`");
    marker = code;
    return atBreak(code);
  }
  function atBreak(code) {
    if (code === marker) {
      effects.enter(types.thematicBreakSequence);
      return sequence(code);
    }
    if (size >= constants.thematicBreakMarkerCountMin && (code === codes.eof || markdownLineEnding(code))) {
      effects.exit(types.thematicBreak);
      return ok2(code);
    }
    return nok(code);
  }
  function sequence(code) {
    if (code === marker) {
      effects.consume(code);
      size++;
      return sequence;
    }
    effects.exit(types.thematicBreakSequence);
    return markdownSpace(code) ? factorySpace(effects, atBreak, types.whitespace)(code) : atBreak(code);
  }
}

// node_modules/micromark-core-commonmark/dev/lib/list.js
var list = {
  continuation: { tokenize: tokenizeListContinuation },
  exit: tokenizeListEnd,
  name: "list",
  tokenize: tokenizeListStart
};
var listItemPrefixWhitespaceConstruct = {
  partial: true,
  tokenize: tokenizeListItemPrefixWhitespace
};
var indentConstruct = { partial: true, tokenize: tokenizeIndent };
function tokenizeListStart(effects, ok2, nok) {
  const self = this;
  const tail = self.events[self.events.length - 1];
  let initialSize = tail && tail[1].type === types.linePrefix ? tail[2].sliceSerialize(tail[1], true).length : 0;
  let size = 0;
  return start;
  function start(code) {
    ok(self.containerState, "expected state");
    const kind = self.containerState.type || (code === codes.asterisk || code === codes.plusSign || code === codes.dash ? types.listUnordered : types.listOrdered);
    if (kind === types.listUnordered ? !self.containerState.marker || code === self.containerState.marker : asciiDigit(code)) {
      if (!self.containerState.type) {
        self.containerState.type = kind;
        effects.enter(kind, { _container: true });
      }
      if (kind === types.listUnordered) {
        effects.enter(types.listItemPrefix);
        return code === codes.asterisk || code === codes.dash ? effects.check(thematicBreak, nok, atMarker)(code) : atMarker(code);
      }
      if (!self.interrupt || code === codes.digit1) {
        effects.enter(types.listItemPrefix);
        effects.enter(types.listItemValue);
        return inside(code);
      }
    }
    return nok(code);
  }
  function inside(code) {
    ok(self.containerState, "expected state");
    if (asciiDigit(code) && ++size < constants.listItemValueSizeMax) {
      effects.consume(code);
      return inside;
    }
    if ((!self.interrupt || size < 2) && (self.containerState.marker ? code === self.containerState.marker : code === codes.rightParenthesis || code === codes.dot)) {
      effects.exit(types.listItemValue);
      return atMarker(code);
    }
    return nok(code);
  }
  function atMarker(code) {
    ok(self.containerState, "expected state");
    ok(code !== codes.eof, "eof (`null`) is not a marker");
    effects.enter(types.listItemMarker);
    effects.consume(code);
    effects.exit(types.listItemMarker);
    self.containerState.marker = self.containerState.marker || code;
    return effects.check(blankLine, self.interrupt ? nok : onBlank, effects.attempt(listItemPrefixWhitespaceConstruct, endOfPrefix, otherPrefix));
  }
  function onBlank(code) {
    ok(self.containerState, "expected state");
    self.containerState.initialBlankLine = true;
    initialSize++;
    return endOfPrefix(code);
  }
  function otherPrefix(code) {
    if (markdownSpace(code)) {
      effects.enter(types.listItemPrefixWhitespace);
      effects.consume(code);
      effects.exit(types.listItemPrefixWhitespace);
      return endOfPrefix;
    }
    return nok(code);
  }
  function endOfPrefix(code) {
    ok(self.containerState, "expected state");
    self.containerState.size = initialSize + self.sliceSerialize(effects.exit(types.listItemPrefix), true).length;
    return ok2(code);
  }
}
function tokenizeListContinuation(effects, ok2, nok) {
  const self = this;
  ok(self.containerState, "expected state");
  self.containerState._closeFlow = undefined;
  return effects.check(blankLine, onBlank, notBlank);
  function onBlank(code) {
    ok(self.containerState, "expected state");
    ok(typeof self.containerState.size === "number", "expected size");
    self.containerState.furtherBlankLines = self.containerState.furtherBlankLines || self.containerState.initialBlankLine;
    return factorySpace(effects, ok2, types.listItemIndent, self.containerState.size + 1)(code);
  }
  function notBlank(code) {
    ok(self.containerState, "expected state");
    if (self.containerState.furtherBlankLines || !markdownSpace(code)) {
      self.containerState.furtherBlankLines = undefined;
      self.containerState.initialBlankLine = undefined;
      return notInCurrentItem(code);
    }
    self.containerState.furtherBlankLines = undefined;
    self.containerState.initialBlankLine = undefined;
    return effects.attempt(indentConstruct, ok2, notInCurrentItem)(code);
  }
  function notInCurrentItem(code) {
    ok(self.containerState, "expected state");
    self.containerState._closeFlow = true;
    self.interrupt = undefined;
    ok(self.parser.constructs.disable.null, "expected `disable.null` to be populated");
    return factorySpace(effects, effects.attempt(list, ok2, nok), types.linePrefix, self.parser.constructs.disable.null.includes("codeIndented") ? undefined : constants.tabSize)(code);
  }
}
function tokenizeIndent(effects, ok2, nok) {
  const self = this;
  ok(self.containerState, "expected state");
  ok(typeof self.containerState.size === "number", "expected size");
  return factorySpace(effects, afterPrefix, types.listItemIndent, self.containerState.size + 1);
  function afterPrefix(code) {
    ok(self.containerState, "expected state");
    const tail = self.events[self.events.length - 1];
    return tail && tail[1].type === types.listItemIndent && tail[2].sliceSerialize(tail[1], true).length === self.containerState.size ? ok2(code) : nok(code);
  }
}
function tokenizeListEnd(effects) {
  ok(this.containerState, "expected state");
  ok(typeof this.containerState.type === "string", "expected type");
  effects.exit(this.containerState.type);
}
function tokenizeListItemPrefixWhitespace(effects, ok2, nok) {
  const self = this;
  ok(self.parser.constructs.disable.null, "expected `disable.null` to be populated");
  return factorySpace(effects, afterPrefix, types.listItemPrefixWhitespace, self.parser.constructs.disable.null.includes("codeIndented") ? undefined : constants.tabSize + 1);
  function afterPrefix(code) {
    const tail = self.events[self.events.length - 1];
    return !markdownSpace(code) && tail && tail[1].type === types.listItemPrefixWhitespace ? ok2(code) : nok(code);
  }
}
// node_modules/micromark-core-commonmark/dev/lib/setext-underline.js
var setextUnderline = {
  name: "setextUnderline",
  resolveTo: resolveToSetextUnderline,
  tokenize: tokenizeSetextUnderline
};
function resolveToSetextUnderline(events, context) {
  let index = events.length;
  let content3;
  let text;
  let definition2;
  while (index--) {
    if (events[index][0] === "enter") {
      if (events[index][1].type === types.content) {
        content3 = index;
        break;
      }
      if (events[index][1].type === types.paragraph) {
        text = index;
      }
    } else {
      if (events[index][1].type === types.content) {
        events.splice(index, 1);
      }
      if (!definition2 && events[index][1].type === types.definition) {
        definition2 = index;
      }
    }
  }
  ok(text !== undefined, "expected a `text` index to be found");
  ok(content3 !== undefined, "expected a `text` index to be found");
  ok(events[content3][2] === context, "enter context should be same");
  ok(events[events.length - 1][2] === context, "enter context should be same");
  const heading = {
    type: types.setextHeading,
    start: { ...events[content3][1].start },
    end: { ...events[events.length - 1][1].end }
  };
  events[text][1].type = types.setextHeadingText;
  if (definition2) {
    events.splice(text, 0, ["enter", heading, context]);
    events.splice(definition2 + 1, 0, ["exit", events[content3][1], context]);
    events[content3][1].end = { ...events[definition2][1].end };
  } else {
    events[content3][1] = heading;
  }
  events.push(["exit", heading, context]);
  return events;
}
function tokenizeSetextUnderline(effects, ok2, nok) {
  const self = this;
  let marker;
  return start;
  function start(code) {
    let index = self.events.length;
    let paragraph;
    ok(code === codes.dash || code === codes.equalsTo, "expected `=` or `-`");
    while (index--) {
      if (self.events[index][1].type !== types.lineEnding && self.events[index][1].type !== types.linePrefix && self.events[index][1].type !== types.content) {
        paragraph = self.events[index][1].type === types.paragraph;
        break;
      }
    }
    if (!self.parser.lazy[self.now().line] && (self.interrupt || paragraph)) {
      effects.enter(types.setextHeadingLine);
      marker = code;
      return before(code);
    }
    return nok(code);
  }
  function before(code) {
    effects.enter(types.setextHeadingLineSequence);
    return inside(code);
  }
  function inside(code) {
    if (code === marker) {
      effects.consume(code);
      return inside;
    }
    effects.exit(types.setextHeadingLineSequence);
    return markdownSpace(code) ? factorySpace(effects, after, types.lineSuffix)(code) : after(code);
  }
  function after(code) {
    if (code === codes.eof || markdownLineEnding(code)) {
      effects.exit(types.setextHeadingLine);
      return ok2(code);
    }
    return nok(code);
  }
}
// node_modules/micromark/dev/lib/initialize/flow.js
var flow = { tokenize: initializeFlow };
function initializeFlow(effects) {
  const self = this;
  const initial = effects.attempt(blankLine, atBlankEnding, effects.attempt(this.parser.constructs.flowInitial, afterConstruct, factorySpace(effects, effects.attempt(this.parser.constructs.flow, afterConstruct, effects.attempt(content2, afterConstruct)), types.linePrefix)));
  return initial;
  function atBlankEnding(code) {
    ok(code === codes.eof || markdownLineEnding(code), "expected eol or eof");
    if (code === codes.eof) {
      effects.consume(code);
      return;
    }
    effects.enter(types.lineEndingBlank);
    effects.consume(code);
    effects.exit(types.lineEndingBlank);
    self.currentConstruct = undefined;
    return initial;
  }
  function afterConstruct(code) {
    ok(code === codes.eof || markdownLineEnding(code), "expected eol or eof");
    if (code === codes.eof) {
      effects.consume(code);
      return;
    }
    effects.enter(types.lineEnding);
    effects.consume(code);
    effects.exit(types.lineEnding);
    self.currentConstruct = undefined;
    return initial;
  }
}

// node_modules/micromark/dev/lib/initialize/text.js
var resolver = { resolveAll: createResolver() };
var string = initializeFactory("string");
var text = initializeFactory("text");
function initializeFactory(field) {
  return {
    resolveAll: createResolver(field === "text" ? resolveAllLineSuffixes : undefined),
    tokenize: initializeText
  };
  function initializeText(effects) {
    const self = this;
    const constructs2 = this.parser.constructs[field];
    const text2 = effects.attempt(constructs2, start, notText);
    return start;
    function start(code) {
      return atBreak(code) ? text2(code) : notText(code);
    }
    function notText(code) {
      if (code === codes.eof) {
        effects.consume(code);
        return;
      }
      effects.enter(types.data);
      effects.consume(code);
      return data;
    }
    function data(code) {
      if (atBreak(code)) {
        effects.exit(types.data);
        return text2(code);
      }
      effects.consume(code);
      return data;
    }
    function atBreak(code) {
      if (code === codes.eof) {
        return true;
      }
      const list2 = constructs2[code];
      let index = -1;
      if (list2) {
        ok(Array.isArray(list2), "expected `disable.null` to be populated");
        while (++index < list2.length) {
          const item = list2[index];
          if (!item.previous || item.previous.call(self, self.previous)) {
            return true;
          }
        }
      }
      return false;
    }
  }
}
function createResolver(extraResolver) {
  return resolveAllText;
  function resolveAllText(events, context) {
    let index = -1;
    let enter;
    while (++index <= events.length) {
      if (enter === undefined) {
        if (events[index] && events[index][1].type === types.data) {
          enter = index;
          index++;
        }
      } else if (!events[index] || events[index][1].type !== types.data) {
        if (index !== enter + 2) {
          events[enter][1].end = events[index - 1][1].end;
          events.splice(enter + 2, index - enter - 2);
          index = enter + 2;
        }
        enter = undefined;
      }
    }
    return extraResolver ? extraResolver(events, context) : events;
  }
}
function resolveAllLineSuffixes(events, context) {
  let eventIndex = 0;
  while (++eventIndex <= events.length) {
    if ((eventIndex === events.length || events[eventIndex][1].type === types.lineEnding) && events[eventIndex - 1][1].type === types.data) {
      const data = events[eventIndex - 1][1];
      const chunks = context.sliceStream(data);
      let index = chunks.length;
      let bufferIndex = -1;
      let size = 0;
      let tabs;
      while (index--) {
        const chunk = chunks[index];
        if (typeof chunk === "string") {
          bufferIndex = chunk.length;
          while (chunk.charCodeAt(bufferIndex - 1) === codes.space) {
            size++;
            bufferIndex--;
          }
          if (bufferIndex)
            break;
          bufferIndex = -1;
        } else if (chunk === codes.horizontalTab) {
          tabs = true;
          size++;
        } else if (chunk === codes.virtualSpace) {} else {
          index++;
          break;
        }
      }
      if (context._contentTypeTextTrailing && eventIndex === events.length) {
        size = 0;
      }
      if (size) {
        const token = {
          type: eventIndex === events.length || tabs || size < constants.hardBreakPrefixSizeMin ? types.lineSuffix : types.hardBreakTrailing,
          start: {
            _bufferIndex: index ? bufferIndex : data.start._bufferIndex + bufferIndex,
            _index: data.start._index + index,
            line: data.end.line,
            column: data.end.column - size,
            offset: data.end.offset - size
          },
          end: { ...data.end }
        };
        data.end = { ...token.start };
        if (data.start.offset === data.end.offset) {
          Object.assign(data, token);
        } else {
          events.splice(eventIndex, 0, ["enter", token, context], ["exit", token, context]);
          eventIndex += 2;
        }
      }
      eventIndex++;
    }
  }
  return events;
}

// node_modules/micromark/dev/lib/constructs.js
var exports_constructs = {};
__export(exports_constructs, {
  text: () => text2,
  string: () => string2,
  insideSpan: () => insideSpan,
  flowInitial: () => flowInitial,
  flow: () => flow2,
  document: () => document3,
  disable: () => disable,
  contentInitial: () => contentInitial,
  attentionMarkers: () => attentionMarkers
});
var document3 = {
  [codes.asterisk]: list,
  [codes.plusSign]: list,
  [codes.dash]: list,
  [codes.digit0]: list,
  [codes.digit1]: list,
  [codes.digit2]: list,
  [codes.digit3]: list,
  [codes.digit4]: list,
  [codes.digit5]: list,
  [codes.digit6]: list,
  [codes.digit7]: list,
  [codes.digit8]: list,
  [codes.digit9]: list,
  [codes.greaterThan]: blockQuote
};
var contentInitial = {
  [codes.leftSquareBracket]: definition
};
var flowInitial = {
  [codes.horizontalTab]: codeIndented,
  [codes.virtualSpace]: codeIndented,
  [codes.space]: codeIndented
};
var flow2 = {
  [codes.numberSign]: headingAtx,
  [codes.asterisk]: thematicBreak,
  [codes.dash]: [setextUnderline, thematicBreak],
  [codes.lessThan]: htmlFlow,
  [codes.equalsTo]: setextUnderline,
  [codes.underscore]: thematicBreak,
  [codes.graveAccent]: codeFenced,
  [codes.tilde]: codeFenced
};
var string2 = {
  [codes.ampersand]: characterReference,
  [codes.backslash]: characterEscape
};
var text2 = {
  [codes.carriageReturn]: lineEnding,
  [codes.lineFeed]: lineEnding,
  [codes.carriageReturnLineFeed]: lineEnding,
  [codes.exclamationMark]: labelStartImage,
  [codes.ampersand]: characterReference,
  [codes.asterisk]: attention,
  [codes.lessThan]: [autolink, htmlText],
  [codes.leftSquareBracket]: labelStartLink,
  [codes.backslash]: [hardBreakEscape, characterEscape],
  [codes.rightSquareBracket]: labelEnd,
  [codes.underscore]: attention,
  [codes.graveAccent]: codeText
};
var insideSpan = { null: [attention, resolver] };
var attentionMarkers = { null: [codes.asterisk, codes.underscore] };
var disable = { null: [] };

// node_modules/micromark/dev/lib/create-tokenizer.js
var import_debug = __toESM(require_src(), 1);
var debug = import_debug.default("micromark");
function createTokenizer(parser, initialize, from) {
  let point = {
    _bufferIndex: -1,
    _index: 0,
    line: from && from.line || 1,
    column: from && from.column || 1,
    offset: from && from.offset || 0
  };
  const columnStart = {};
  const resolveAllConstructs = [];
  let chunks = [];
  let stack = [];
  let consumed = true;
  const effects = {
    attempt: constructFactory(onsuccessfulconstruct),
    check: constructFactory(onsuccessfulcheck),
    consume,
    enter,
    exit: exit2,
    interrupt: constructFactory(onsuccessfulcheck, { interrupt: true })
  };
  const context = {
    code: codes.eof,
    containerState: {},
    defineSkip,
    events: [],
    now,
    parser,
    previous: codes.eof,
    sliceSerialize,
    sliceStream,
    write
  };
  let state = initialize.tokenize.call(context, effects);
  let expectedCode;
  if (initialize.resolveAll) {
    resolveAllConstructs.push(initialize);
  }
  return context;
  function write(slice) {
    chunks = push(chunks, slice);
    main();
    if (chunks[chunks.length - 1] !== codes.eof) {
      return [];
    }
    addResult(initialize, 0);
    context.events = resolveAll(resolveAllConstructs, context.events, context);
    return context.events;
  }
  function sliceSerialize(token, expandTabs) {
    return serializeChunks(sliceStream(token), expandTabs);
  }
  function sliceStream(token) {
    return sliceChunks(chunks, token);
  }
  function now() {
    const { _bufferIndex, _index, line, column, offset } = point;
    return { _bufferIndex, _index, line, column, offset };
  }
  function defineSkip(value) {
    columnStart[value.line] = value.column;
    accountForPotentialSkip();
    debug("position: define skip: `%j`", point);
  }
  function main() {
    let chunkIndex;
    while (point._index < chunks.length) {
      const chunk = chunks[point._index];
      if (typeof chunk === "string") {
        chunkIndex = point._index;
        if (point._bufferIndex < 0) {
          point._bufferIndex = 0;
        }
        while (point._index === chunkIndex && point._bufferIndex < chunk.length) {
          go(chunk.charCodeAt(point._bufferIndex));
        }
      } else {
        go(chunk);
      }
    }
  }
  function go(code) {
    ok(consumed === true, "expected character to be consumed");
    consumed = undefined;
    debug("main: passing `%s` to %s", code, state && state.name);
    expectedCode = code;
    ok(typeof state === "function", "expected state");
    state = state(code);
  }
  function consume(code) {
    ok(code === expectedCode, "expected given code to equal expected code");
    debug("consume: `%s`", code);
    ok(consumed === undefined, "expected code to not have been consumed: this might be because `return x(code)` instead of `return x` was used");
    ok(code === null ? context.events.length === 0 || context.events[context.events.length - 1][0] === "exit" : context.events[context.events.length - 1][0] === "enter", "expected last token to be open");
    if (markdownLineEnding(code)) {
      point.line++;
      point.column = 1;
      point.offset += code === codes.carriageReturnLineFeed ? 2 : 1;
      accountForPotentialSkip();
      debug("position: after eol: `%j`", point);
    } else if (code !== codes.virtualSpace) {
      point.column++;
      point.offset++;
    }
    if (point._bufferIndex < 0) {
      point._index++;
    } else {
      point._bufferIndex++;
      if (point._bufferIndex === chunks[point._index].length) {
        point._bufferIndex = -1;
        point._index++;
      }
    }
    context.previous = code;
    consumed = true;
  }
  function enter(type, fields) {
    const token = fields || {};
    token.type = type;
    token.start = now();
    ok(typeof type === "string", "expected string type");
    ok(type.length > 0, "expected non-empty string");
    debug("enter: `%s`", type);
    context.events.push(["enter", token, context]);
    stack.push(token);
    return token;
  }
  function exit2(type) {
    ok(typeof type === "string", "expected string type");
    ok(type.length > 0, "expected non-empty string");
    const token = stack.pop();
    ok(token, "cannot close w/o open tokens");
    token.end = now();
    ok(type === token.type, "expected exit token to match current token");
    ok(!(token.start._index === token.end._index && token.start._bufferIndex === token.end._bufferIndex), "expected non-empty token (`" + type + "`)");
    debug("exit: `%s`", token.type);
    context.events.push(["exit", token, context]);
    return token;
  }
  function onsuccessfulconstruct(construct, info) {
    addResult(construct, info.from);
  }
  function onsuccessfulcheck(_, info) {
    info.restore();
  }
  function constructFactory(onreturn, fields) {
    return hook;
    function hook(constructs2, returnState, bogusState) {
      let listOfConstructs;
      let constructIndex;
      let currentConstruct;
      let info;
      return Array.isArray(constructs2) ? handleListOfConstructs(constructs2) : ("tokenize" in constructs2) ? handleListOfConstructs([constructs2]) : handleMapOfConstructs(constructs2);
      function handleMapOfConstructs(map) {
        return start;
        function start(code) {
          const left = code !== null && map[code];
          const all2 = code !== null && map.null;
          const list2 = [
            ...Array.isArray(left) ? left : left ? [left] : [],
            ...Array.isArray(all2) ? all2 : all2 ? [all2] : []
          ];
          return handleListOfConstructs(list2)(code);
        }
      }
      function handleListOfConstructs(list2) {
        listOfConstructs = list2;
        constructIndex = 0;
        if (list2.length === 0) {
          ok(bogusState, "expected `bogusState` to be given");
          return bogusState;
        }
        return handleConstruct(list2[constructIndex]);
      }
      function handleConstruct(construct) {
        return start;
        function start(code) {
          info = store();
          currentConstruct = construct;
          if (!construct.partial) {
            context.currentConstruct = construct;
          }
          ok(context.parser.constructs.disable.null, "expected `disable.null` to be populated");
          if (construct.name && context.parser.constructs.disable.null.includes(construct.name)) {
            return nok(code);
          }
          return construct.tokenize.call(fields ? Object.assign(Object.create(context), fields) : context, effects, ok2, nok)(code);
        }
      }
      function ok2(code) {
        ok(code === expectedCode, "expected code");
        consumed = true;
        onreturn(currentConstruct, info);
        return returnState;
      }
      function nok(code) {
        ok(code === expectedCode, "expected code");
        consumed = true;
        info.restore();
        if (++constructIndex < listOfConstructs.length) {
          return handleConstruct(listOfConstructs[constructIndex]);
        }
        return bogusState;
      }
    }
  }
  function addResult(construct, from2) {
    if (construct.resolveAll && !resolveAllConstructs.includes(construct)) {
      resolveAllConstructs.push(construct);
    }
    if (construct.resolve) {
      splice(context.events, from2, context.events.length - from2, construct.resolve(context.events.slice(from2), context));
    }
    if (construct.resolveTo) {
      context.events = construct.resolveTo(context.events, context);
    }
    ok(construct.partial || context.events.length === 0 || context.events[context.events.length - 1][0] === "exit", "expected last token to end");
  }
  function store() {
    const startPoint = now();
    const startPrevious = context.previous;
    const startCurrentConstruct = context.currentConstruct;
    const startEventsIndex = context.events.length;
    const startStack = Array.from(stack);
    return { from: startEventsIndex, restore };
    function restore() {
      point = startPoint;
      context.previous = startPrevious;
      context.currentConstruct = startCurrentConstruct;
      context.events.length = startEventsIndex;
      stack = startStack;
      accountForPotentialSkip();
      debug("position: restore: `%j`", point);
    }
  }
  function accountForPotentialSkip() {
    if (point.line in columnStart && point.column < 2) {
      point.column = columnStart[point.line];
      point.offset += columnStart[point.line] - 1;
    }
  }
}
function sliceChunks(chunks, token) {
  const startIndex = token.start._index;
  const startBufferIndex = token.start._bufferIndex;
  const endIndex = token.end._index;
  const endBufferIndex = token.end._bufferIndex;
  let view;
  if (startIndex === endIndex) {
    ok(endBufferIndex > -1, "expected non-negative end buffer index");
    ok(startBufferIndex > -1, "expected non-negative start buffer index");
    view = [chunks[startIndex].slice(startBufferIndex, endBufferIndex)];
  } else {
    view = chunks.slice(startIndex, endIndex);
    if (startBufferIndex > -1) {
      const head = view[0];
      if (typeof head === "string") {
        view[0] = head.slice(startBufferIndex);
      } else {
        ok(startBufferIndex === 0, "expected `startBufferIndex` to be `0`");
        view.shift();
      }
    }
    if (endBufferIndex > 0) {
      view.push(chunks[endIndex].slice(0, endBufferIndex));
    }
  }
  return view;
}
function serializeChunks(chunks, expandTabs) {
  let index = -1;
  const result = [];
  let atTab;
  while (++index < chunks.length) {
    const chunk = chunks[index];
    let value;
    if (typeof chunk === "string") {
      value = chunk;
    } else
      switch (chunk) {
        case codes.carriageReturn: {
          value = values.cr;
          break;
        }
        case codes.lineFeed: {
          value = values.lf;
          break;
        }
        case codes.carriageReturnLineFeed: {
          value = values.cr + values.lf;
          break;
        }
        case codes.horizontalTab: {
          value = expandTabs ? values.space : values.ht;
          break;
        }
        case codes.virtualSpace: {
          if (!expandTabs && atTab)
            continue;
          value = values.space;
          break;
        }
        default: {
          ok(typeof chunk === "number", "expected number");
          value = String.fromCharCode(chunk);
        }
      }
    atTab = chunk === codes.horizontalTab;
    result.push(value);
  }
  return result.join("");
}

// node_modules/micromark/dev/lib/parse.js
function parse(options) {
  const settings = options || {};
  const constructs2 = combineExtensions([exports_constructs, ...settings.extensions || []]);
  const parser = {
    constructs: constructs2,
    content: create(content),
    defined: [],
    document: create(document2),
    flow: create(flow),
    lazy: {},
    string: create(string),
    text: create(text)
  };
  return parser;
  function create(initial) {
    return creator;
    function creator(from) {
      return createTokenizer(parser, initial, from);
    }
  }
}

// node_modules/micromark/dev/lib/postprocess.js
function postprocess(events) {
  while (!subtokenize(events)) {}
  return events;
}

// node_modules/micromark/dev/lib/preprocess.js
var search = /[\0\t\n\r]/g;
function preprocess() {
  let column = 1;
  let buffer = "";
  let start = true;
  let atCarriageReturn;
  return preprocessor;
  function preprocessor(value, encoding, end) {
    const chunks = [];
    let match;
    let next;
    let startPosition;
    let endPosition;
    let code;
    value = buffer + (typeof value === "string" ? value.toString() : new TextDecoder(encoding || undefined).decode(value));
    startPosition = 0;
    buffer = "";
    if (start) {
      if (value.charCodeAt(0) === codes.byteOrderMarker) {
        startPosition++;
      }
      start = undefined;
    }
    while (startPosition < value.length) {
      search.lastIndex = startPosition;
      match = search.exec(value);
      endPosition = match && match.index !== undefined ? match.index : value.length;
      code = value.charCodeAt(endPosition);
      if (!match) {
        buffer = value.slice(startPosition);
        break;
      }
      if (code === codes.lf && startPosition === endPosition && atCarriageReturn) {
        chunks.push(codes.carriageReturnLineFeed);
        atCarriageReturn = undefined;
      } else {
        if (atCarriageReturn) {
          chunks.push(codes.carriageReturn);
          atCarriageReturn = undefined;
        }
        if (startPosition < endPosition) {
          chunks.push(value.slice(startPosition, endPosition));
          column += endPosition - startPosition;
        }
        switch (code) {
          case codes.nul: {
            chunks.push(codes.replacementCharacter);
            column++;
            break;
          }
          case codes.ht: {
            next = Math.ceil(column / constants.tabSize) * constants.tabSize;
            chunks.push(codes.horizontalTab);
            while (column++ < next)
              chunks.push(codes.virtualSpace);
            break;
          }
          case codes.lf: {
            chunks.push(codes.lineFeed);
            column = 1;
            break;
          }
          default: {
            atCarriageReturn = true;
            column = 1;
          }
        }
      }
      startPosition = endPosition + 1;
    }
    if (end) {
      if (atCarriageReturn)
        chunks.push(codes.carriageReturn);
      if (buffer)
        chunks.push(buffer);
      chunks.push(codes.eof);
    }
    return chunks;
  }
}
// node_modules/micromark-util-decode-string/dev/index.js
var characterEscapeOrReference = /\\([!-/:-@[-`{-~])|&(#(?:\d{1,7}|x[\da-f]{1,6})|[\da-z]{1,31});/gi;
function decodeString(value) {
  return value.replace(characterEscapeOrReference, decode);
}
function decode($0, $1, $2) {
  if ($1) {
    return $1;
  }
  const head = $2.charCodeAt(0);
  if (head === codes.numberSign) {
    const head2 = $2.charCodeAt(1);
    const hex = head2 === codes.lowercaseX || head2 === codes.uppercaseX;
    return decodeNumericCharacterReference($2.slice(hex ? 2 : 1), hex ? constants.numericBaseHexadecimal : constants.numericBaseDecimal);
  }
  return decodeNamedCharacterReference($2) || $0;
}

// node_modules/unist-util-stringify-position/lib/index.js
function stringifyPosition(value) {
  if (!value || typeof value !== "object") {
    return "";
  }
  if ("position" in value || "type" in value) {
    return position(value.position);
  }
  if ("start" in value || "end" in value) {
    return position(value);
  }
  if ("line" in value || "column" in value) {
    return point(value);
  }
  return "";
}
function point(point2) {
  return index(point2 && point2.line) + ":" + index(point2 && point2.column);
}
function position(pos) {
  return point(pos && pos.start) + "-" + point(pos && pos.end);
}
function index(value) {
  return value && typeof value === "number" ? value : 1;
}
// node_modules/mdast-util-from-markdown/dev/lib/index.js
var own2 = {}.hasOwnProperty;
function fromMarkdown(value, encoding, options) {
  if (encoding && typeof encoding === "object") {
    options = encoding;
    encoding = undefined;
  }
  return compiler(options)(postprocess(parse(options).document().write(preprocess()(value, encoding, true))));
}
function compiler(options) {
  const config = {
    transforms: [],
    canContainEols: ["emphasis", "fragment", "heading", "paragraph", "strong"],
    enter: {
      autolink: opener(link),
      autolinkProtocol: onenterdata,
      autolinkEmail: onenterdata,
      atxHeading: opener(heading),
      blockQuote: opener(blockQuote2),
      characterEscape: onenterdata,
      characterReference: onenterdata,
      codeFenced: opener(codeFlow),
      codeFencedFenceInfo: buffer,
      codeFencedFenceMeta: buffer,
      codeIndented: opener(codeFlow, buffer),
      codeText: opener(codeText2, buffer),
      codeTextData: onenterdata,
      data: onenterdata,
      codeFlowValue: onenterdata,
      definition: opener(definition2),
      definitionDestinationString: buffer,
      definitionLabelString: buffer,
      definitionTitleString: buffer,
      emphasis: opener(emphasis),
      hardBreakEscape: opener(hardBreak),
      hardBreakTrailing: opener(hardBreak),
      htmlFlow: opener(html, buffer),
      htmlFlowData: onenterdata,
      htmlText: opener(html, buffer),
      htmlTextData: onenterdata,
      image: opener(image),
      label: buffer,
      link: opener(link),
      listItem: opener(listItem),
      listItemValue: onenterlistitemvalue,
      listOrdered: opener(list2, onenterlistordered),
      listUnordered: opener(list2),
      paragraph: opener(paragraph),
      reference: onenterreference,
      referenceString: buffer,
      resourceDestinationString: buffer,
      resourceTitleString: buffer,
      setextHeading: opener(heading),
      strong: opener(strong),
      thematicBreak: opener(thematicBreak2)
    },
    exit: {
      atxHeading: closer(),
      atxHeadingSequence: onexitatxheadingsequence,
      autolink: closer(),
      autolinkEmail: onexitautolinkemail,
      autolinkProtocol: onexitautolinkprotocol,
      blockQuote: closer(),
      characterEscapeValue: onexitdata,
      characterReferenceMarkerHexadecimal: onexitcharacterreferencemarker,
      characterReferenceMarkerNumeric: onexitcharacterreferencemarker,
      characterReferenceValue: onexitcharacterreferencevalue,
      characterReference: onexitcharacterreference,
      codeFenced: closer(onexitcodefenced),
      codeFencedFence: onexitcodefencedfence,
      codeFencedFenceInfo: onexitcodefencedfenceinfo,
      codeFencedFenceMeta: onexitcodefencedfencemeta,
      codeFlowValue: onexitdata,
      codeIndented: closer(onexitcodeindented),
      codeText: closer(onexitcodetext),
      codeTextData: onexitdata,
      data: onexitdata,
      definition: closer(),
      definitionDestinationString: onexitdefinitiondestinationstring,
      definitionLabelString: onexitdefinitionlabelstring,
      definitionTitleString: onexitdefinitiontitlestring,
      emphasis: closer(),
      hardBreakEscape: closer(onexithardbreak),
      hardBreakTrailing: closer(onexithardbreak),
      htmlFlow: closer(onexithtmlflow),
      htmlFlowData: onexitdata,
      htmlText: closer(onexithtmltext),
      htmlTextData: onexitdata,
      image: closer(onexitimage),
      label: onexitlabel,
      labelText: onexitlabeltext,
      lineEnding: onexitlineending,
      link: closer(onexitlink),
      listItem: closer(),
      listOrdered: closer(),
      listUnordered: closer(),
      paragraph: closer(),
      referenceString: onexitreferencestring,
      resourceDestinationString: onexitresourcedestinationstring,
      resourceTitleString: onexitresourcetitlestring,
      resource: onexitresource,
      setextHeading: closer(onexitsetextheading),
      setextHeadingLineSequence: onexitsetextheadinglinesequence,
      setextHeadingText: onexitsetextheadingtext,
      strong: closer(),
      thematicBreak: closer()
    }
  };
  configure(config, (options || {}).mdastExtensions || []);
  const data = {};
  return compile;
  function compile(events) {
    let tree = { type: "root", children: [] };
    const context = {
      stack: [tree],
      tokenStack: [],
      config,
      enter,
      exit: exit2,
      buffer,
      resume,
      data
    };
    const listStack = [];
    let index2 = -1;
    while (++index2 < events.length) {
      if (events[index2][1].type === types.listOrdered || events[index2][1].type === types.listUnordered) {
        if (events[index2][0] === "enter") {
          listStack.push(index2);
        } else {
          const tail = listStack.pop();
          ok(typeof tail === "number", "expected list to be open");
          index2 = prepareList(events, tail, index2);
        }
      }
    }
    index2 = -1;
    while (++index2 < events.length) {
      const handler = config[events[index2][0]];
      if (own2.call(handler, events[index2][1].type)) {
        handler[events[index2][1].type].call(Object.assign({ sliceSerialize: events[index2][2].sliceSerialize }, context), events[index2][1]);
      }
    }
    if (context.tokenStack.length > 0) {
      const tail = context.tokenStack[context.tokenStack.length - 1];
      const handler = tail[1] || defaultOnError;
      handler.call(context, undefined, tail[0]);
    }
    tree.position = {
      start: point2(events.length > 0 ? events[0][1].start : { line: 1, column: 1, offset: 0 }),
      end: point2(events.length > 0 ? events[events.length - 2][1].end : { line: 1, column: 1, offset: 0 })
    };
    index2 = -1;
    while (++index2 < config.transforms.length) {
      tree = config.transforms[index2](tree) || tree;
    }
    return tree;
  }
  function prepareList(events, start, length) {
    let index2 = start - 1;
    let containerBalance = -1;
    let listSpread = false;
    let listItem2;
    let lineIndex;
    let firstBlankLineIndex;
    let atMarker;
    while (++index2 <= length) {
      const event = events[index2];
      switch (event[1].type) {
        case types.listUnordered:
        case types.listOrdered:
        case types.blockQuote: {
          if (event[0] === "enter") {
            containerBalance++;
          } else {
            containerBalance--;
          }
          atMarker = undefined;
          break;
        }
        case types.lineEndingBlank: {
          if (event[0] === "enter") {
            if (listItem2 && !atMarker && !containerBalance && !firstBlankLineIndex) {
              firstBlankLineIndex = index2;
            }
            atMarker = undefined;
          }
          break;
        }
        case types.linePrefix:
        case types.listItemValue:
        case types.listItemMarker:
        case types.listItemPrefix:
        case types.listItemPrefixWhitespace: {
          break;
        }
        default: {
          atMarker = undefined;
        }
      }
      if (!containerBalance && event[0] === "enter" && event[1].type === types.listItemPrefix || containerBalance === -1 && event[0] === "exit" && (event[1].type === types.listUnordered || event[1].type === types.listOrdered)) {
        if (listItem2) {
          let tailIndex = index2;
          lineIndex = undefined;
          while (tailIndex--) {
            const tailEvent = events[tailIndex];
            if (tailEvent[1].type === types.lineEnding || tailEvent[1].type === types.lineEndingBlank) {
              if (tailEvent[0] === "exit")
                continue;
              if (lineIndex) {
                events[lineIndex][1].type = types.lineEndingBlank;
                listSpread = true;
              }
              tailEvent[1].type = types.lineEnding;
              lineIndex = tailIndex;
            } else if (tailEvent[1].type === types.linePrefix || tailEvent[1].type === types.blockQuotePrefix || tailEvent[1].type === types.blockQuotePrefixWhitespace || tailEvent[1].type === types.blockQuoteMarker || tailEvent[1].type === types.listItemIndent) {} else {
              break;
            }
          }
          if (firstBlankLineIndex && (!lineIndex || firstBlankLineIndex < lineIndex)) {
            listItem2._spread = true;
          }
          listItem2.end = Object.assign({}, lineIndex ? events[lineIndex][1].start : event[1].end);
          events.splice(lineIndex || index2, 0, ["exit", listItem2, event[2]]);
          index2++;
          length++;
        }
        if (event[1].type === types.listItemPrefix) {
          const item = {
            type: "listItem",
            _spread: false,
            start: Object.assign({}, event[1].start),
            end: undefined
          };
          listItem2 = item;
          events.splice(index2, 0, ["enter", item, event[2]]);
          index2++;
          length++;
          firstBlankLineIndex = undefined;
          atMarker = true;
        }
      }
    }
    events[start][1]._spread = listSpread;
    return length;
  }
  function opener(create, and) {
    return open;
    function open(token) {
      enter.call(this, create(token), token);
      if (and)
        and.call(this, token);
    }
  }
  function buffer() {
    this.stack.push({ type: "fragment", children: [] });
  }
  function enter(node2, token, errorHandler) {
    const parent = this.stack[this.stack.length - 1];
    ok(parent, "expected `parent`");
    ok("children" in parent, "expected `parent`");
    const siblings = parent.children;
    siblings.push(node2);
    this.stack.push(node2);
    this.tokenStack.push([token, errorHandler || undefined]);
    node2.position = {
      start: point2(token.start),
      end: undefined
    };
  }
  function closer(and) {
    return close;
    function close(token) {
      if (and)
        and.call(this, token);
      exit2.call(this, token);
    }
  }
  function exit2(token, onExitError) {
    const node2 = this.stack.pop();
    ok(node2, "expected `node`");
    const open = this.tokenStack.pop();
    if (!open) {
      throw new Error("Cannot close `" + token.type + "` (" + stringifyPosition({ start: token.start, end: token.end }) + "): it’s not open");
    } else if (open[0].type !== token.type) {
      if (onExitError) {
        onExitError.call(this, token, open[0]);
      } else {
        const handler = open[1] || defaultOnError;
        handler.call(this, token, open[0]);
      }
    }
    ok(node2.type !== "fragment", "unexpected fragment `exit`ed");
    ok(node2.position, "expected `position` to be defined");
    node2.position.end = point2(token.end);
  }
  function resume() {
    return toString(this.stack.pop());
  }
  function onenterlistordered() {
    this.data.expectingFirstListItemValue = true;
  }
  function onenterlistitemvalue(token) {
    if (this.data.expectingFirstListItemValue) {
      const ancestor = this.stack[this.stack.length - 2];
      ok(ancestor, "expected nodes on stack");
      ok(ancestor.type === "list", "expected list on stack");
      ancestor.start = Number.parseInt(this.sliceSerialize(token), constants.numericBaseDecimal);
      this.data.expectingFirstListItemValue = undefined;
    }
  }
  function onexitcodefencedfenceinfo() {
    const data2 = this.resume();
    const node2 = this.stack[this.stack.length - 1];
    ok(node2, "expected node on stack");
    ok(node2.type === "code", "expected code on stack");
    node2.lang = data2;
  }
  function onexitcodefencedfencemeta() {
    const data2 = this.resume();
    const node2 = this.stack[this.stack.length - 1];
    ok(node2, "expected node on stack");
    ok(node2.type === "code", "expected code on stack");
    node2.meta = data2;
  }
  function onexitcodefencedfence() {
    if (this.data.flowCodeInside)
      return;
    this.buffer();
    this.data.flowCodeInside = true;
  }
  function onexitcodefenced() {
    const data2 = this.resume();
    const node2 = this.stack[this.stack.length - 1];
    ok(node2, "expected node on stack");
    ok(node2.type === "code", "expected code on stack");
    node2.value = data2.replace(/^(\r?\n|\r)|(\r?\n|\r)$/g, "");
    this.data.flowCodeInside = undefined;
  }
  function onexitcodeindented() {
    const data2 = this.resume();
    const node2 = this.stack[this.stack.length - 1];
    ok(node2, "expected node on stack");
    ok(node2.type === "code", "expected code on stack");
    node2.value = data2.replace(/(\r?\n|\r)$/g, "");
  }
  function onexitdefinitionlabelstring(token) {
    const label = this.resume();
    const node2 = this.stack[this.stack.length - 1];
    ok(node2, "expected node on stack");
    ok(node2.type === "definition", "expected definition on stack");
    node2.label = label;
    node2.identifier = normalizeIdentifier(this.sliceSerialize(token)).toLowerCase();
  }
  function onexitdefinitiontitlestring() {
    const data2 = this.resume();
    const node2 = this.stack[this.stack.length - 1];
    ok(node2, "expected node on stack");
    ok(node2.type === "definition", "expected definition on stack");
    node2.title = data2;
  }
  function onexitdefinitiondestinationstring() {
    const data2 = this.resume();
    const node2 = this.stack[this.stack.length - 1];
    ok(node2, "expected node on stack");
    ok(node2.type === "definition", "expected definition on stack");
    node2.url = data2;
  }
  function onexitatxheadingsequence(token) {
    const node2 = this.stack[this.stack.length - 1];
    ok(node2, "expected node on stack");
    ok(node2.type === "heading", "expected heading on stack");
    if (!node2.depth) {
      const depth = this.sliceSerialize(token).length;
      ok(depth === 1 || depth === 2 || depth === 3 || depth === 4 || depth === 5 || depth === 6, "expected `depth` between `1` and `6`");
      node2.depth = depth;
    }
  }
  function onexitsetextheadingtext() {
    this.data.setextHeadingSlurpLineEnding = true;
  }
  function onexitsetextheadinglinesequence(token) {
    const node2 = this.stack[this.stack.length - 1];
    ok(node2, "expected node on stack");
    ok(node2.type === "heading", "expected heading on stack");
    node2.depth = this.sliceSerialize(token).codePointAt(0) === codes.equalsTo ? 1 : 2;
  }
  function onexitsetextheading() {
    this.data.setextHeadingSlurpLineEnding = undefined;
  }
  function onenterdata(token) {
    const node2 = this.stack[this.stack.length - 1];
    ok(node2, "expected node on stack");
    ok("children" in node2, "expected parent on stack");
    const siblings = node2.children;
    let tail = siblings[siblings.length - 1];
    if (!tail || tail.type !== "text") {
      tail = text3();
      tail.position = {
        start: point2(token.start),
        end: undefined
      };
      siblings.push(tail);
    }
    this.stack.push(tail);
  }
  function onexitdata(token) {
    const tail = this.stack.pop();
    ok(tail, "expected a `node` to be on the stack");
    ok("value" in tail, "expected a `literal` to be on the stack");
    ok(tail.position, "expected `node` to have an open position");
    tail.value += this.sliceSerialize(token);
    tail.position.end = point2(token.end);
  }
  function onexitlineending(token) {
    const context = this.stack[this.stack.length - 1];
    ok(context, "expected `node`");
    if (this.data.atHardBreak) {
      ok("children" in context, "expected `parent`");
      const tail = context.children[context.children.length - 1];
      ok(tail.position, "expected tail to have a starting position");
      tail.position.end = point2(token.end);
      this.data.atHardBreak = undefined;
      return;
    }
    if (!this.data.setextHeadingSlurpLineEnding && config.canContainEols.includes(context.type)) {
      onenterdata.call(this, token);
      onexitdata.call(this, token);
    }
  }
  function onexithardbreak() {
    this.data.atHardBreak = true;
  }
  function onexithtmlflow() {
    const data2 = this.resume();
    const node2 = this.stack[this.stack.length - 1];
    ok(node2, "expected node on stack");
    ok(node2.type === "html", "expected html on stack");
    node2.value = data2;
  }
  function onexithtmltext() {
    const data2 = this.resume();
    const node2 = this.stack[this.stack.length - 1];
    ok(node2, "expected node on stack");
    ok(node2.type === "html", "expected html on stack");
    node2.value = data2;
  }
  function onexitcodetext() {
    const data2 = this.resume();
    const node2 = this.stack[this.stack.length - 1];
    ok(node2, "expected node on stack");
    ok(node2.type === "inlineCode", "expected inline code on stack");
    node2.value = data2;
  }
  function onexitlink() {
    const node2 = this.stack[this.stack.length - 1];
    ok(node2, "expected node on stack");
    ok(node2.type === "link", "expected link on stack");
    if (this.data.inReference) {
      const referenceType = this.data.referenceType || "shortcut";
      node2.type += "Reference";
      node2.referenceType = referenceType;
      delete node2.url;
      delete node2.title;
    } else {
      delete node2.identifier;
      delete node2.label;
    }
    this.data.referenceType = undefined;
  }
  function onexitimage() {
    const node2 = this.stack[this.stack.length - 1];
    ok(node2, "expected node on stack");
    ok(node2.type === "image", "expected image on stack");
    if (this.data.inReference) {
      const referenceType = this.data.referenceType || "shortcut";
      node2.type += "Reference";
      node2.referenceType = referenceType;
      delete node2.url;
      delete node2.title;
    } else {
      delete node2.identifier;
      delete node2.label;
    }
    this.data.referenceType = undefined;
  }
  function onexitlabeltext(token) {
    const string3 = this.sliceSerialize(token);
    const ancestor = this.stack[this.stack.length - 2];
    ok(ancestor, "expected ancestor on stack");
    ok(ancestor.type === "image" || ancestor.type === "link", "expected image or link on stack");
    ancestor.label = decodeString(string3);
    ancestor.identifier = normalizeIdentifier(string3).toLowerCase();
  }
  function onexitlabel() {
    const fragment = this.stack[this.stack.length - 1];
    ok(fragment, "expected node on stack");
    ok(fragment.type === "fragment", "expected fragment on stack");
    const value = this.resume();
    const node2 = this.stack[this.stack.length - 1];
    ok(node2, "expected node on stack");
    ok(node2.type === "image" || node2.type === "link", "expected image or link on stack");
    this.data.inReference = true;
    if (node2.type === "link") {
      const children = fragment.children;
      node2.children = children;
    } else {
      node2.alt = value;
    }
  }
  function onexitresourcedestinationstring() {
    const data2 = this.resume();
    const node2 = this.stack[this.stack.length - 1];
    ok(node2, "expected node on stack");
    ok(node2.type === "image" || node2.type === "link", "expected image or link on stack");
    node2.url = data2;
  }
  function onexitresourcetitlestring() {
    const data2 = this.resume();
    const node2 = this.stack[this.stack.length - 1];
    ok(node2, "expected node on stack");
    ok(node2.type === "image" || node2.type === "link", "expected image or link on stack");
    node2.title = data2;
  }
  function onexitresource() {
    this.data.inReference = undefined;
  }
  function onenterreference() {
    this.data.referenceType = "collapsed";
  }
  function onexitreferencestring(token) {
    const label = this.resume();
    const node2 = this.stack[this.stack.length - 1];
    ok(node2, "expected node on stack");
    ok(node2.type === "image" || node2.type === "link", "expected image reference or link reference on stack");
    node2.label = label;
    node2.identifier = normalizeIdentifier(this.sliceSerialize(token)).toLowerCase();
    this.data.referenceType = "full";
  }
  function onexitcharacterreferencemarker(token) {
    ok(token.type === "characterReferenceMarkerNumeric" || token.type === "characterReferenceMarkerHexadecimal");
    this.data.characterReferenceType = token.type;
  }
  function onexitcharacterreferencevalue(token) {
    const data2 = this.sliceSerialize(token);
    const type = this.data.characterReferenceType;
    let value;
    if (type) {
      value = decodeNumericCharacterReference(data2, type === types.characterReferenceMarkerNumeric ? constants.numericBaseDecimal : constants.numericBaseHexadecimal);
      this.data.characterReferenceType = undefined;
    } else {
      const result = decodeNamedCharacterReference(data2);
      ok(result !== false, "expected reference to decode");
      value = result;
    }
    const tail = this.stack[this.stack.length - 1];
    ok(tail, "expected `node`");
    ok("value" in tail, "expected `node.value`");
    tail.value += value;
  }
  function onexitcharacterreference(token) {
    const tail = this.stack.pop();
    ok(tail, "expected `node`");
    ok(tail.position, "expected `node.position`");
    tail.position.end = point2(token.end);
  }
  function onexitautolinkprotocol(token) {
    onexitdata.call(this, token);
    const node2 = this.stack[this.stack.length - 1];
    ok(node2, "expected node on stack");
    ok(node2.type === "link", "expected link on stack");
    node2.url = this.sliceSerialize(token);
  }
  function onexitautolinkemail(token) {
    onexitdata.call(this, token);
    const node2 = this.stack[this.stack.length - 1];
    ok(node2, "expected node on stack");
    ok(node2.type === "link", "expected link on stack");
    node2.url = "mailto:" + this.sliceSerialize(token);
  }
  function blockQuote2() {
    return { type: "blockquote", children: [] };
  }
  function codeFlow() {
    return { type: "code", lang: null, meta: null, value: "" };
  }
  function codeText2() {
    return { type: "inlineCode", value: "" };
  }
  function definition2() {
    return {
      type: "definition",
      identifier: "",
      label: null,
      title: null,
      url: ""
    };
  }
  function emphasis() {
    return { type: "emphasis", children: [] };
  }
  function heading() {
    return {
      type: "heading",
      depth: 0,
      children: []
    };
  }
  function hardBreak() {
    return { type: "break" };
  }
  function html() {
    return { type: "html", value: "" };
  }
  function image() {
    return { type: "image", title: null, url: "", alt: null };
  }
  function link() {
    return { type: "link", title: null, url: "", children: [] };
  }
  function list2(token) {
    return {
      type: "list",
      ordered: token.type === "listOrdered",
      start: null,
      spread: token._spread,
      children: []
    };
  }
  function listItem(token) {
    return {
      type: "listItem",
      spread: token._spread,
      checked: null,
      children: []
    };
  }
  function paragraph() {
    return { type: "paragraph", children: [] };
  }
  function strong() {
    return { type: "strong", children: [] };
  }
  function text3() {
    return { type: "text", value: "" };
  }
  function thematicBreak2() {
    return { type: "thematicBreak" };
  }
}
function point2(d) {
  return { line: d.line, column: d.column, offset: d.offset };
}
function configure(combined, extensions) {
  let index2 = -1;
  while (++index2 < extensions.length) {
    const value = extensions[index2];
    if (Array.isArray(value)) {
      configure(combined, value);
    } else {
      extension(combined, value);
    }
  }
}
function extension(combined, extension2) {
  let key;
  for (key in extension2) {
    if (own2.call(extension2, key)) {
      switch (key) {
        case "canContainEols": {
          const right = extension2[key];
          if (right) {
            combined[key].push(...right);
          }
          break;
        }
        case "transforms": {
          const right = extension2[key];
          if (right) {
            combined[key].push(...right);
          }
          break;
        }
        case "enter":
        case "exit": {
          const right = extension2[key];
          if (right) {
            Object.assign(combined[key], right);
          }
          break;
        }
      }
    }
  }
}
function defaultOnError(left, right) {
  if (left) {
    throw new Error("Cannot close `" + left.type + "` (" + stringifyPosition({ start: left.start, end: left.end }) + "): a different token (`" + right.type + "`, " + stringifyPosition({ start: right.start, end: right.end }) + ") is open");
  } else {
    throw new Error("Cannot close document, a token (`" + right.type + "`, " + stringifyPosition({ start: right.start, end: right.end }) + ") is still open");
  }
}
// node_modules/ccount/index.js
function ccount(value, character) {
  const source = String(value);
  if (typeof character !== "string") {
    throw new TypeError("Expected character");
  }
  let count = 0;
  let index2 = source.indexOf(character);
  while (index2 !== -1) {
    count++;
    index2 = source.indexOf(character, index2 + character.length);
  }
  return count;
}

// node_modules/escape-string-regexp/index.js
function escapeStringRegexp(string3) {
  if (typeof string3 !== "string") {
    throw new TypeError("Expected a string");
  }
  return string3.replace(/[|\\{}()[\]^$+*?.]/g, "\\$&").replace(/-/g, "\\x2d");
}

// node_modules/unist-util-is/lib/index.js
var convert = function(test) {
  if (test === null || test === undefined) {
    return ok2;
  }
  if (typeof test === "function") {
    return castFactory(test);
  }
  if (typeof test === "object") {
    return Array.isArray(test) ? anyFactory(test) : propertiesFactory(test);
  }
  if (typeof test === "string") {
    return typeFactory(test);
  }
  throw new Error("Expected function, string, or object as test");
};
function anyFactory(tests) {
  const checks = [];
  let index2 = -1;
  while (++index2 < tests.length) {
    checks[index2] = convert(tests[index2]);
  }
  return castFactory(any);
  function any(...parameters) {
    let index3 = -1;
    while (++index3 < checks.length) {
      if (checks[index3].apply(this, parameters))
        return true;
    }
    return false;
  }
}
function propertiesFactory(check) {
  const checkAsRecord = check;
  return castFactory(all2);
  function all2(node2) {
    const nodeAsRecord = node2;
    let key;
    for (key in check) {
      if (nodeAsRecord[key] !== checkAsRecord[key])
        return false;
    }
    return true;
  }
}
function typeFactory(check) {
  return castFactory(type);
  function type(node2) {
    return node2 && node2.type === check;
  }
}
function castFactory(testFunction) {
  return check;
  function check(value, index2, parent) {
    return Boolean(looksLikeANode(value) && testFunction.call(this, value, typeof index2 === "number" ? index2 : undefined, parent || undefined));
  }
}
function ok2() {
  return true;
}
function looksLikeANode(value) {
  return value !== null && typeof value === "object" && "type" in value;
}
// node_modules/unist-util-visit-parents/lib/color.node.js
function color(d) {
  return "\x1B[33m" + d + "\x1B[39m";
}

// node_modules/unist-util-visit-parents/lib/index.js
var empty = [];
var CONTINUE = true;
var EXIT = false;
var SKIP = "skip";
function visitParents(tree, test, visitor, reverse) {
  let check;
  if (typeof test === "function" && typeof visitor !== "function") {
    reverse = visitor;
    visitor = test;
  } else {
    check = test;
  }
  const is2 = convert(check);
  const step = reverse ? -1 : 1;
  factory(tree, undefined, [])();
  function factory(node2, index2, parents) {
    const value = node2 && typeof node2 === "object" ? node2 : {};
    if (typeof value.type === "string") {
      const name = typeof value.tagName === "string" ? value.tagName : typeof value.name === "string" ? value.name : undefined;
      Object.defineProperty(visit, "name", {
        value: "node (" + color(node2.type + (name ? "<" + name + ">" : "")) + ")"
      });
    }
    return visit;
    function visit() {
      let result = empty;
      let subresult;
      let offset;
      let grandparents;
      if (!test || is2(node2, index2, parents[parents.length - 1] || undefined)) {
        result = toResult(visitor(node2, parents));
        if (result[0] === EXIT) {
          return result;
        }
      }
      if ("children" in node2 && node2.children) {
        const nodeAsParent = node2;
        if (nodeAsParent.children && result[0] !== SKIP) {
          offset = (reverse ? nodeAsParent.children.length : -1) + step;
          grandparents = parents.concat(nodeAsParent);
          while (offset > -1 && offset < nodeAsParent.children.length) {
            const child = nodeAsParent.children[offset];
            subresult = factory(child, offset, grandparents)();
            if (subresult[0] === EXIT) {
              return subresult;
            }
            offset = typeof subresult[1] === "number" ? subresult[1] : offset + step;
          }
        }
      }
      return result;
    }
  }
}
function toResult(value) {
  if (Array.isArray(value)) {
    return value;
  }
  if (typeof value === "number") {
    return [CONTINUE, value];
  }
  return value === null || value === undefined ? empty : [value];
}
// node_modules/mdast-util-find-and-replace/lib/index.js
function findAndReplace(tree, list2, options) {
  const settings = options || {};
  const ignored = convert(settings.ignore || []);
  const pairs = toPairs(list2);
  let pairIndex = -1;
  while (++pairIndex < pairs.length) {
    visitParents(tree, "text", visitor);
  }
  function visitor(node2, parents) {
    let index2 = -1;
    let grandparent;
    while (++index2 < parents.length) {
      const parent = parents[index2];
      const siblings = grandparent ? grandparent.children : undefined;
      if (ignored(parent, siblings ? siblings.indexOf(parent) : undefined, grandparent)) {
        return;
      }
      grandparent = parent;
    }
    if (grandparent) {
      return handler(node2, parents);
    }
  }
  function handler(node2, parents) {
    const parent = parents[parents.length - 1];
    const find = pairs[pairIndex][0];
    const replace = pairs[pairIndex][1];
    let start = 0;
    const siblings = parent.children;
    const index2 = siblings.indexOf(node2);
    let change = false;
    let nodes = [];
    find.lastIndex = 0;
    let match = find.exec(node2.value);
    while (match) {
      const position2 = match.index;
      const matchObject = {
        index: match.index,
        input: match.input,
        stack: [...parents, node2]
      };
      let value = replace(...match, matchObject);
      if (typeof value === "string") {
        value = value.length > 0 ? { type: "text", value } : undefined;
      }
      if (value === false) {
        find.lastIndex = position2 + 1;
      } else {
        if (start !== position2) {
          nodes.push({
            type: "text",
            value: node2.value.slice(start, position2)
          });
        }
        if (Array.isArray(value)) {
          nodes.push(...value);
        } else if (value) {
          nodes.push(value);
        }
        start = position2 + match[0].length;
        change = true;
      }
      if (!find.global) {
        break;
      }
      match = find.exec(node2.value);
    }
    if (change) {
      if (start < node2.value.length) {
        nodes.push({ type: "text", value: node2.value.slice(start) });
      }
      parent.children.splice(index2, 1, ...nodes);
    } else {
      nodes = [node2];
    }
    return index2 + nodes.length;
  }
}
function toPairs(tupleOrList) {
  const result = [];
  if (!Array.isArray(tupleOrList)) {
    throw new TypeError("Expected find and replace tuple or list of tuples");
  }
  const list2 = !tupleOrList[0] || Array.isArray(tupleOrList[0]) ? tupleOrList : [tupleOrList];
  let index2 = -1;
  while (++index2 < list2.length) {
    const tuple = list2[index2];
    result.push([toExpression(tuple[0]), toFunction(tuple[1])]);
  }
  return result;
}
function toExpression(find) {
  return typeof find === "string" ? new RegExp(escapeStringRegexp(find), "g") : find;
}
function toFunction(replace) {
  return typeof replace === "function" ? replace : function() {
    return replace;
  };
}
// node_modules/mdast-util-gfm-autolink-literal/lib/index.js
function gfmAutolinkLiteralFromMarkdown() {
  return {
    transforms: [transformGfmAutolinkLiterals],
    enter: {
      literalAutolink: enterLiteralAutolink,
      literalAutolinkEmail: enterLiteralAutolinkValue,
      literalAutolinkHttp: enterLiteralAutolinkValue,
      literalAutolinkWww: enterLiteralAutolinkValue
    },
    exit: {
      literalAutolink: exitLiteralAutolink,
      literalAutolinkEmail: exitLiteralAutolinkEmail,
      literalAutolinkHttp: exitLiteralAutolinkHttp,
      literalAutolinkWww: exitLiteralAutolinkWww
    }
  };
}
function enterLiteralAutolink(token) {
  this.enter({ type: "link", title: null, url: "", children: [] }, token);
}
function enterLiteralAutolinkValue(token) {
  this.config.enter.autolinkProtocol.call(this, token);
}
function exitLiteralAutolinkHttp(token) {
  this.config.exit.autolinkProtocol.call(this, token);
}
function exitLiteralAutolinkWww(token) {
  this.config.exit.data.call(this, token);
  const node2 = this.stack[this.stack.length - 1];
  ok(node2.type === "link");
  node2.url = "http://" + this.sliceSerialize(token);
}
function exitLiteralAutolinkEmail(token) {
  this.config.exit.autolinkEmail.call(this, token);
}
function exitLiteralAutolink(token) {
  this.exit(token);
}
function transformGfmAutolinkLiterals(tree) {
  findAndReplace(tree, [
    [/(https?:\/\/|www(?=\.))([-.\w]+)([^ \t\r\n]*)/gi, findUrl],
    [/(?<=^|\s|\p{P}|\p{S})([-.\w+]+)@([-\w]+(?:\.[-\w]+)+)/gu, findEmail]
  ], { ignore: ["link", "linkReference"] });
}
function findUrl(_, protocol, domain, path, match) {
  let prefix = "";
  if (!previous2(match)) {
    return false;
  }
  if (/^w/i.test(protocol)) {
    domain = protocol + domain;
    protocol = "";
    prefix = "http://";
  }
  if (!isCorrectDomain(domain)) {
    return false;
  }
  const parts = splitUrl(domain + path);
  if (!parts[0])
    return false;
  const result = {
    type: "link",
    title: null,
    url: prefix + protocol + parts[0],
    children: [{ type: "text", value: protocol + parts[0] }]
  };
  if (parts[1]) {
    return [result, { type: "text", value: parts[1] }];
  }
  return result;
}
function findEmail(_, atext, label, match) {
  if (!previous2(match, true) || /[-\d_]$/.test(label)) {
    return false;
  }
  return {
    type: "link",
    title: null,
    url: "mailto:" + atext + "@" + label,
    children: [{ type: "text", value: atext + "@" + label }]
  };
}
function isCorrectDomain(domain) {
  const parts = domain.split(".");
  if (parts.length < 2 || parts[parts.length - 1] && (/_/.test(parts[parts.length - 1]) || !/[a-zA-Z\d]/.test(parts[parts.length - 1])) || parts[parts.length - 2] && (/_/.test(parts[parts.length - 2]) || !/[a-zA-Z\d]/.test(parts[parts.length - 2]))) {
    return false;
  }
  return true;
}
function splitUrl(url) {
  const trailExec = /[!"&'),.:;<>?\]}]+$/.exec(url);
  if (!trailExec) {
    return [url, undefined];
  }
  url = url.slice(0, trailExec.index);
  let trail = trailExec[0];
  let closingParenIndex = trail.indexOf(")");
  const openingParens = ccount(url, "(");
  let closingParens = ccount(url, ")");
  while (closingParenIndex !== -1 && openingParens > closingParens) {
    url += trail.slice(0, closingParenIndex + 1);
    trail = trail.slice(closingParenIndex + 1);
    closingParenIndex = trail.indexOf(")");
    closingParens++;
  }
  return [url, trail];
}
function previous2(match, email) {
  const code = match.input.charCodeAt(match.index - 1);
  return (match.index === 0 || unicodeWhitespace(code) || unicodePunctuation(code)) && (!email || code !== 47);
}
// node_modules/mdast-util-gfm-footnote/lib/index.js
footnoteReference.peek = footnoteReferencePeek;
function enterFootnoteCallString() {
  this.buffer();
}
function enterFootnoteCall(token) {
  this.enter({ type: "footnoteReference", identifier: "", label: "" }, token);
}
function enterFootnoteDefinitionLabelString() {
  this.buffer();
}
function enterFootnoteDefinition(token) {
  this.enter({ type: "footnoteDefinition", identifier: "", label: "", children: [] }, token);
}
function exitFootnoteCallString(token) {
  const label = this.resume();
  const node2 = this.stack[this.stack.length - 1];
  ok(node2.type === "footnoteReference");
  node2.identifier = normalizeIdentifier(this.sliceSerialize(token)).toLowerCase();
  node2.label = label;
}
function exitFootnoteCall(token) {
  this.exit(token);
}
function exitFootnoteDefinitionLabelString(token) {
  const label = this.resume();
  const node2 = this.stack[this.stack.length - 1];
  ok(node2.type === "footnoteDefinition");
  node2.identifier = normalizeIdentifier(this.sliceSerialize(token)).toLowerCase();
  node2.label = label;
}
function exitFootnoteDefinition(token) {
  this.exit(token);
}
function footnoteReferencePeek() {
  return "[";
}
function footnoteReference(node2, _, state, info) {
  const tracker = state.createTracker(info);
  let value = tracker.move("[^");
  const exit2 = state.enter("footnoteReference");
  const subexit = state.enter("reference");
  value += tracker.move(state.safe(state.associationId(node2), { after: "]", before: value }));
  subexit();
  exit2();
  value += tracker.move("]");
  return value;
}
function gfmFootnoteFromMarkdown() {
  return {
    enter: {
      gfmFootnoteCallString: enterFootnoteCallString,
      gfmFootnoteCall: enterFootnoteCall,
      gfmFootnoteDefinitionLabelString: enterFootnoteDefinitionLabelString,
      gfmFootnoteDefinition: enterFootnoteDefinition
    },
    exit: {
      gfmFootnoteCallString: exitFootnoteCallString,
      gfmFootnoteCall: exitFootnoteCall,
      gfmFootnoteDefinitionLabelString: exitFootnoteDefinitionLabelString,
      gfmFootnoteDefinition: exitFootnoteDefinition
    }
  };
}
// node_modules/mdast-util-gfm-strikethrough/lib/index.js
handleDelete.peek = peekDelete;
function gfmStrikethroughFromMarkdown() {
  return {
    canContainEols: ["delete"],
    enter: { strikethrough: enterStrikethrough },
    exit: { strikethrough: exitStrikethrough }
  };
}
function enterStrikethrough(token) {
  this.enter({ type: "delete", children: [] }, token);
}
function exitStrikethrough(token) {
  this.exit(token);
}
function handleDelete(node2, _, state, info) {
  const tracker = state.createTracker(info);
  const exit2 = state.enter("strikethrough");
  let value = tracker.move("~~");
  value += state.containerPhrasing(node2, {
    ...tracker.current(),
    before: value,
    after: "~"
  });
  value += tracker.move("~~");
  exit2();
  return value;
}
function peekDelete() {
  return "~";
}
// node_modules/mdast-util-gfm-table/lib/index.js
function gfmTableFromMarkdown() {
  return {
    enter: {
      table: enterTable,
      tableData: enterCell,
      tableHeader: enterCell,
      tableRow: enterRow
    },
    exit: {
      codeText: exitCodeText,
      table: exitTable,
      tableData: exit2,
      tableHeader: exit2,
      tableRow: exit2
    }
  };
}
function enterTable(token) {
  const align = token._align;
  ok(align, "expected `_align` on table");
  this.enter({
    type: "table",
    align: align.map(function(d) {
      return d === "none" ? null : d;
    }),
    children: []
  }, token);
  this.data.inTable = true;
}
function exitTable(token) {
  this.exit(token);
  this.data.inTable = undefined;
}
function enterRow(token) {
  this.enter({ type: "tableRow", children: [] }, token);
}
function exit2(token) {
  this.exit(token);
}
function enterCell(token) {
  this.enter({ type: "tableCell", children: [] }, token);
}
function exitCodeText(token) {
  let value = this.resume();
  if (this.data.inTable) {
    value = value.replace(/\\([\\|])/g, replace);
  }
  const node2 = this.stack[this.stack.length - 1];
  ok(node2.type === "inlineCode");
  node2.value = value;
  this.exit(token);
}
function replace($0, $1) {
  return $1 === "|" ? $1 : $0;
}
// node_modules/mdast-util-gfm-task-list-item/lib/index.js
function gfmTaskListItemFromMarkdown() {
  return {
    exit: {
      taskListCheckValueChecked: exitCheck,
      taskListCheckValueUnchecked: exitCheck,
      paragraph: exitParagraphWithTaskListItem
    }
  };
}
function exitCheck(token) {
  const node2 = this.stack[this.stack.length - 2];
  ok(node2.type === "listItem");
  node2.checked = token.type === "taskListCheckValueChecked";
}
function exitParagraphWithTaskListItem(token) {
  const parent = this.stack[this.stack.length - 2];
  if (parent && parent.type === "listItem" && typeof parent.checked === "boolean") {
    const node2 = this.stack[this.stack.length - 1];
    ok(node2.type === "paragraph");
    const head = node2.children[0];
    if (head && head.type === "text") {
      const siblings = parent.children;
      let index2 = -1;
      let firstParaghraph;
      while (++index2 < siblings.length) {
        const sibling = siblings[index2];
        if (sibling.type === "paragraph") {
          firstParaghraph = sibling;
          break;
        }
      }
      if (firstParaghraph === node2) {
        head.value = head.value.slice(1);
        if (head.value.length === 0) {
          node2.children.shift();
        } else if (node2.position && head.position && typeof head.position.start.offset === "number") {
          head.position.start.column++;
          head.position.start.offset++;
          node2.position.start = Object.assign({}, head.position.start);
        }
      }
    }
  }
  this.exit(token);
}
// node_modules/mdast-util-gfm/lib/index.js
function gfmFromMarkdown() {
  return [
    gfmAutolinkLiteralFromMarkdown(),
    gfmFootnoteFromMarkdown(),
    gfmStrikethroughFromMarkdown(),
    gfmTableFromMarkdown(),
    gfmTaskListItemFromMarkdown()
  ];
}
// node_modules/micromark-extension-gfm-autolink-literal/dev/lib/syntax.js
var wwwPrefix = { tokenize: tokenizeWwwPrefix, partial: true };
var domain = { tokenize: tokenizeDomain, partial: true };
var path = { tokenize: tokenizePath, partial: true };
var trail = { tokenize: tokenizeTrail, partial: true };
var emailDomainDotTrail = {
  tokenize: tokenizeEmailDomainDotTrail,
  partial: true
};
var wwwAutolink = {
  name: "wwwAutolink",
  tokenize: tokenizeWwwAutolink,
  previous: previousWww
};
var protocolAutolink = {
  name: "protocolAutolink",
  tokenize: tokenizeProtocolAutolink,
  previous: previousProtocol
};
var emailAutolink = {
  name: "emailAutolink",
  tokenize: tokenizeEmailAutolink,
  previous: previousEmail
};
var text3 = {};
function gfmAutolinkLiteral() {
  return { text: text3 };
}
var code = codes.digit0;
while (code < codes.leftCurlyBrace) {
  text3[code] = emailAutolink;
  code++;
  if (code === codes.colon)
    code = codes.uppercaseA;
  else if (code === codes.leftSquareBracket)
    code = codes.lowercaseA;
}
text3[codes.plusSign] = emailAutolink;
text3[codes.dash] = emailAutolink;
text3[codes.dot] = emailAutolink;
text3[codes.underscore] = emailAutolink;
text3[codes.uppercaseH] = [emailAutolink, protocolAutolink];
text3[codes.lowercaseH] = [emailAutolink, protocolAutolink];
text3[codes.uppercaseW] = [emailAutolink, wwwAutolink];
text3[codes.lowercaseW] = [emailAutolink, wwwAutolink];
function tokenizeEmailAutolink(effects, ok3, nok) {
  const self = this;
  let dot;
  let data;
  return start;
  function start(code2) {
    if (!gfmAtext(code2) || !previousEmail.call(self, self.previous) || previousUnbalanced(self.events)) {
      return nok(code2);
    }
    effects.enter("literalAutolink");
    effects.enter("literalAutolinkEmail");
    return atext(code2);
  }
  function atext(code2) {
    if (gfmAtext(code2)) {
      effects.consume(code2);
      return atext;
    }
    if (code2 === codes.atSign) {
      effects.consume(code2);
      return emailDomain;
    }
    return nok(code2);
  }
  function emailDomain(code2) {
    if (code2 === codes.dot) {
      return effects.check(emailDomainDotTrail, emailDomainAfter, emailDomainDot)(code2);
    }
    if (code2 === codes.dash || code2 === codes.underscore || asciiAlphanumeric(code2)) {
      data = true;
      effects.consume(code2);
      return emailDomain;
    }
    return emailDomainAfter(code2);
  }
  function emailDomainDot(code2) {
    effects.consume(code2);
    dot = true;
    return emailDomain;
  }
  function emailDomainAfter(code2) {
    if (data && dot && asciiAlpha(self.previous)) {
      effects.exit("literalAutolinkEmail");
      effects.exit("literalAutolink");
      return ok3(code2);
    }
    return nok(code2);
  }
}
function tokenizeWwwAutolink(effects, ok3, nok) {
  const self = this;
  return wwwStart;
  function wwwStart(code2) {
    if (code2 !== codes.uppercaseW && code2 !== codes.lowercaseW || !previousWww.call(self, self.previous) || previousUnbalanced(self.events)) {
      return nok(code2);
    }
    effects.enter("literalAutolink");
    effects.enter("literalAutolinkWww");
    return effects.check(wwwPrefix, effects.attempt(domain, effects.attempt(path, wwwAfter), nok), nok)(code2);
  }
  function wwwAfter(code2) {
    effects.exit("literalAutolinkWww");
    effects.exit("literalAutolink");
    return ok3(code2);
  }
}
function tokenizeProtocolAutolink(effects, ok3, nok) {
  const self = this;
  let buffer = "";
  let seen = false;
  return protocolStart;
  function protocolStart(code2) {
    if ((code2 === codes.uppercaseH || code2 === codes.lowercaseH) && previousProtocol.call(self, self.previous) && !previousUnbalanced(self.events)) {
      effects.enter("literalAutolink");
      effects.enter("literalAutolinkHttp");
      buffer += String.fromCodePoint(code2);
      effects.consume(code2);
      return protocolPrefixInside;
    }
    return nok(code2);
  }
  function protocolPrefixInside(code2) {
    if (asciiAlpha(code2) && buffer.length < 5) {
      buffer += String.fromCodePoint(code2);
      effects.consume(code2);
      return protocolPrefixInside;
    }
    if (code2 === codes.colon) {
      const protocol = buffer.toLowerCase();
      if (protocol === "http" || protocol === "https") {
        effects.consume(code2);
        return protocolSlashesInside;
      }
    }
    return nok(code2);
  }
  function protocolSlashesInside(code2) {
    if (code2 === codes.slash) {
      effects.consume(code2);
      if (seen) {
        return afterProtocol;
      }
      seen = true;
      return protocolSlashesInside;
    }
    return nok(code2);
  }
  function afterProtocol(code2) {
    return code2 === codes.eof || asciiControl(code2) || markdownLineEndingOrSpace(code2) || unicodeWhitespace(code2) || unicodePunctuation(code2) ? nok(code2) : effects.attempt(domain, effects.attempt(path, protocolAfter), nok)(code2);
  }
  function protocolAfter(code2) {
    effects.exit("literalAutolinkHttp");
    effects.exit("literalAutolink");
    return ok3(code2);
  }
}
function tokenizeWwwPrefix(effects, ok3, nok) {
  let size = 0;
  return wwwPrefixInside;
  function wwwPrefixInside(code2) {
    if ((code2 === codes.uppercaseW || code2 === codes.lowercaseW) && size < 3) {
      size++;
      effects.consume(code2);
      return wwwPrefixInside;
    }
    if (code2 === codes.dot && size === 3) {
      effects.consume(code2);
      return wwwPrefixAfter;
    }
    return nok(code2);
  }
  function wwwPrefixAfter(code2) {
    return code2 === codes.eof ? nok(code2) : ok3(code2);
  }
}
function tokenizeDomain(effects, ok3, nok) {
  let underscoreInLastSegment;
  let underscoreInLastLastSegment;
  let seen;
  return domainInside;
  function domainInside(code2) {
    if (code2 === codes.dot || code2 === codes.underscore) {
      return effects.check(trail, domainAfter, domainAtPunctuation)(code2);
    }
    if (code2 === codes.eof || markdownLineEndingOrSpace(code2) || unicodeWhitespace(code2) || code2 !== codes.dash && unicodePunctuation(code2)) {
      return domainAfter(code2);
    }
    seen = true;
    effects.consume(code2);
    return domainInside;
  }
  function domainAtPunctuation(code2) {
    if (code2 === codes.underscore) {
      underscoreInLastSegment = true;
    } else {
      underscoreInLastLastSegment = underscoreInLastSegment;
      underscoreInLastSegment = undefined;
    }
    effects.consume(code2);
    return domainInside;
  }
  function domainAfter(code2) {
    if (underscoreInLastLastSegment || underscoreInLastSegment || !seen) {
      return nok(code2);
    }
    return ok3(code2);
  }
}
function tokenizePath(effects, ok3) {
  let sizeOpen = 0;
  let sizeClose = 0;
  return pathInside;
  function pathInside(code2) {
    if (code2 === codes.leftParenthesis) {
      sizeOpen++;
      effects.consume(code2);
      return pathInside;
    }
    if (code2 === codes.rightParenthesis && sizeClose < sizeOpen) {
      return pathAtPunctuation(code2);
    }
    if (code2 === codes.exclamationMark || code2 === codes.quotationMark || code2 === codes.ampersand || code2 === codes.apostrophe || code2 === codes.rightParenthesis || code2 === codes.asterisk || code2 === codes.comma || code2 === codes.dot || code2 === codes.colon || code2 === codes.semicolon || code2 === codes.lessThan || code2 === codes.questionMark || code2 === codes.rightSquareBracket || code2 === codes.underscore || code2 === codes.tilde) {
      return effects.check(trail, ok3, pathAtPunctuation)(code2);
    }
    if (code2 === codes.eof || markdownLineEndingOrSpace(code2) || unicodeWhitespace(code2)) {
      return ok3(code2);
    }
    effects.consume(code2);
    return pathInside;
  }
  function pathAtPunctuation(code2) {
    if (code2 === codes.rightParenthesis) {
      sizeClose++;
    }
    effects.consume(code2);
    return pathInside;
  }
}
function tokenizeTrail(effects, ok3, nok) {
  return trail2;
  function trail2(code2) {
    if (code2 === codes.exclamationMark || code2 === codes.quotationMark || code2 === codes.apostrophe || code2 === codes.rightParenthesis || code2 === codes.asterisk || code2 === codes.comma || code2 === codes.dot || code2 === codes.colon || code2 === codes.semicolon || code2 === codes.questionMark || code2 === codes.underscore || code2 === codes.tilde) {
      effects.consume(code2);
      return trail2;
    }
    if (code2 === codes.ampersand) {
      effects.consume(code2);
      return trailCharacterReferenceStart;
    }
    if (code2 === codes.rightSquareBracket) {
      effects.consume(code2);
      return trailBracketAfter;
    }
    if (code2 === codes.lessThan || code2 === codes.eof || markdownLineEndingOrSpace(code2) || unicodeWhitespace(code2)) {
      return ok3(code2);
    }
    return nok(code2);
  }
  function trailBracketAfter(code2) {
    if (code2 === codes.eof || code2 === codes.leftParenthesis || code2 === codes.leftSquareBracket || markdownLineEndingOrSpace(code2) || unicodeWhitespace(code2)) {
      return ok3(code2);
    }
    return trail2(code2);
  }
  function trailCharacterReferenceStart(code2) {
    return asciiAlpha(code2) ? trailCharacterReferenceInside(code2) : nok(code2);
  }
  function trailCharacterReferenceInside(code2) {
    if (code2 === codes.semicolon) {
      effects.consume(code2);
      return trail2;
    }
    if (asciiAlpha(code2)) {
      effects.consume(code2);
      return trailCharacterReferenceInside;
    }
    return nok(code2);
  }
}
function tokenizeEmailDomainDotTrail(effects, ok3, nok) {
  return start;
  function start(code2) {
    effects.consume(code2);
    return after;
  }
  function after(code2) {
    return asciiAlphanumeric(code2) ? nok(code2) : ok3(code2);
  }
}
function previousWww(code2) {
  return code2 === codes.eof || code2 === codes.leftParenthesis || code2 === codes.asterisk || code2 === codes.underscore || code2 === codes.leftSquareBracket || code2 === codes.rightSquareBracket || code2 === codes.tilde || markdownLineEndingOrSpace(code2);
}
function previousProtocol(code2) {
  return !asciiAlpha(code2);
}
function previousEmail(code2) {
  return !(code2 === codes.slash || gfmAtext(code2));
}
function gfmAtext(code2) {
  return code2 === codes.plusSign || code2 === codes.dash || code2 === codes.dot || code2 === codes.underscore || asciiAlphanumeric(code2);
}
function previousUnbalanced(events) {
  let index2 = events.length;
  let result = false;
  while (index2--) {
    const token = events[index2][1];
    if ((token.type === "labelLink" || token.type === "labelImage") && !token._balanced) {
      result = true;
      break;
    }
    if (token._gfmAutolinkLiteralWalkedInto) {
      result = false;
      break;
    }
  }
  if (events.length > 0 && !result) {
    events[events.length - 1][1]._gfmAutolinkLiteralWalkedInto = true;
  }
  return result;
}
// node_modules/micromark-extension-gfm-footnote/dev/lib/syntax.js
var indent = { tokenize: tokenizeIndent2, partial: true };
function gfmFootnote() {
  return {
    document: {
      [codes.leftSquareBracket]: {
        name: "gfmFootnoteDefinition",
        tokenize: tokenizeDefinitionStart,
        continuation: { tokenize: tokenizeDefinitionContinuation },
        exit: gfmFootnoteDefinitionEnd
      }
    },
    text: {
      [codes.leftSquareBracket]: {
        name: "gfmFootnoteCall",
        tokenize: tokenizeGfmFootnoteCall
      },
      [codes.rightSquareBracket]: {
        name: "gfmPotentialFootnoteCall",
        add: "after",
        tokenize: tokenizePotentialGfmFootnoteCall,
        resolveTo: resolveToPotentialGfmFootnoteCall
      }
    }
  };
}
function tokenizePotentialGfmFootnoteCall(effects, ok3, nok) {
  const self = this;
  let index2 = self.events.length;
  const defined = self.parser.gfmFootnotes || (self.parser.gfmFootnotes = []);
  let labelStart;
  while (index2--) {
    const token = self.events[index2][1];
    if (token.type === types.labelImage) {
      labelStart = token;
      break;
    }
    if (token.type === "gfmFootnoteCall" || token.type === types.labelLink || token.type === types.label || token.type === types.image || token.type === types.link) {
      break;
    }
  }
  return start;
  function start(code2) {
    ok(code2 === codes.rightSquareBracket, "expected `]`");
    if (!labelStart || !labelStart._balanced) {
      return nok(code2);
    }
    const id = normalizeIdentifier(self.sliceSerialize({ start: labelStart.end, end: self.now() }));
    if (id.codePointAt(0) !== codes.caret || !defined.includes(id.slice(1))) {
      return nok(code2);
    }
    effects.enter("gfmFootnoteCallLabelMarker");
    effects.consume(code2);
    effects.exit("gfmFootnoteCallLabelMarker");
    return ok3(code2);
  }
}
function resolveToPotentialGfmFootnoteCall(events, context) {
  let index2 = events.length;
  let labelStart;
  while (index2--) {
    if (events[index2][1].type === types.labelImage && events[index2][0] === "enter") {
      labelStart = events[index2][1];
      break;
    }
  }
  ok(labelStart, "expected `labelStart` to resolve");
  events[index2 + 1][1].type = types.data;
  events[index2 + 3][1].type = "gfmFootnoteCallLabelMarker";
  const call = {
    type: "gfmFootnoteCall",
    start: Object.assign({}, events[index2 + 3][1].start),
    end: Object.assign({}, events[events.length - 1][1].end)
  };
  const marker = {
    type: "gfmFootnoteCallMarker",
    start: Object.assign({}, events[index2 + 3][1].end),
    end: Object.assign({}, events[index2 + 3][1].end)
  };
  marker.end.column++;
  marker.end.offset++;
  marker.end._bufferIndex++;
  const string3 = {
    type: "gfmFootnoteCallString",
    start: Object.assign({}, marker.end),
    end: Object.assign({}, events[events.length - 1][1].start)
  };
  const chunk = {
    type: types.chunkString,
    contentType: "string",
    start: Object.assign({}, string3.start),
    end: Object.assign({}, string3.end)
  };
  const replacement = [
    events[index2 + 1],
    events[index2 + 2],
    ["enter", call, context],
    events[index2 + 3],
    events[index2 + 4],
    ["enter", marker, context],
    ["exit", marker, context],
    ["enter", string3, context],
    ["enter", chunk, context],
    ["exit", chunk, context],
    ["exit", string3, context],
    events[events.length - 2],
    events[events.length - 1],
    ["exit", call, context]
  ];
  events.splice(index2, events.length - index2 + 1, ...replacement);
  return events;
}
function tokenizeGfmFootnoteCall(effects, ok3, nok) {
  const self = this;
  const defined = self.parser.gfmFootnotes || (self.parser.gfmFootnotes = []);
  let size = 0;
  let data;
  return start;
  function start(code2) {
    ok(code2 === codes.leftSquareBracket, "expected `[`");
    effects.enter("gfmFootnoteCall");
    effects.enter("gfmFootnoteCallLabelMarker");
    effects.consume(code2);
    effects.exit("gfmFootnoteCallLabelMarker");
    return callStart;
  }
  function callStart(code2) {
    if (code2 !== codes.caret)
      return nok(code2);
    effects.enter("gfmFootnoteCallMarker");
    effects.consume(code2);
    effects.exit("gfmFootnoteCallMarker");
    effects.enter("gfmFootnoteCallString");
    effects.enter("chunkString").contentType = "string";
    return callData;
  }
  function callData(code2) {
    if (size > constants.linkReferenceSizeMax || code2 === codes.rightSquareBracket && !data || code2 === codes.eof || code2 === codes.leftSquareBracket || markdownLineEndingOrSpace(code2)) {
      return nok(code2);
    }
    if (code2 === codes.rightSquareBracket) {
      effects.exit("chunkString");
      const token = effects.exit("gfmFootnoteCallString");
      if (!defined.includes(normalizeIdentifier(self.sliceSerialize(token)))) {
        return nok(code2);
      }
      effects.enter("gfmFootnoteCallLabelMarker");
      effects.consume(code2);
      effects.exit("gfmFootnoteCallLabelMarker");
      effects.exit("gfmFootnoteCall");
      return ok3;
    }
    if (!markdownLineEndingOrSpace(code2)) {
      data = true;
    }
    size++;
    effects.consume(code2);
    return code2 === codes.backslash ? callEscape : callData;
  }
  function callEscape(code2) {
    if (code2 === codes.leftSquareBracket || code2 === codes.backslash || code2 === codes.rightSquareBracket) {
      effects.consume(code2);
      size++;
      return callData;
    }
    return callData(code2);
  }
}
function tokenizeDefinitionStart(effects, ok3, nok) {
  const self = this;
  const defined = self.parser.gfmFootnotes || (self.parser.gfmFootnotes = []);
  let identifier;
  let size = 0;
  let data;
  return start;
  function start(code2) {
    ok(code2 === codes.leftSquareBracket, "expected `[`");
    effects.enter("gfmFootnoteDefinition")._container = true;
    effects.enter("gfmFootnoteDefinitionLabel");
    effects.enter("gfmFootnoteDefinitionLabelMarker");
    effects.consume(code2);
    effects.exit("gfmFootnoteDefinitionLabelMarker");
    return labelAtMarker;
  }
  function labelAtMarker(code2) {
    if (code2 === codes.caret) {
      effects.enter("gfmFootnoteDefinitionMarker");
      effects.consume(code2);
      effects.exit("gfmFootnoteDefinitionMarker");
      effects.enter("gfmFootnoteDefinitionLabelString");
      effects.enter("chunkString").contentType = "string";
      return labelInside;
    }
    return nok(code2);
  }
  function labelInside(code2) {
    if (size > constants.linkReferenceSizeMax || code2 === codes.rightSquareBracket && !data || code2 === codes.eof || code2 === codes.leftSquareBracket || markdownLineEndingOrSpace(code2)) {
      return nok(code2);
    }
    if (code2 === codes.rightSquareBracket) {
      effects.exit("chunkString");
      const token = effects.exit("gfmFootnoteDefinitionLabelString");
      identifier = normalizeIdentifier(self.sliceSerialize(token));
      effects.enter("gfmFootnoteDefinitionLabelMarker");
      effects.consume(code2);
      effects.exit("gfmFootnoteDefinitionLabelMarker");
      effects.exit("gfmFootnoteDefinitionLabel");
      return labelAfter;
    }
    if (!markdownLineEndingOrSpace(code2)) {
      data = true;
    }
    size++;
    effects.consume(code2);
    return code2 === codes.backslash ? labelEscape : labelInside;
  }
  function labelEscape(code2) {
    if (code2 === codes.leftSquareBracket || code2 === codes.backslash || code2 === codes.rightSquareBracket) {
      effects.consume(code2);
      size++;
      return labelInside;
    }
    return labelInside(code2);
  }
  function labelAfter(code2) {
    if (code2 === codes.colon) {
      effects.enter("definitionMarker");
      effects.consume(code2);
      effects.exit("definitionMarker");
      if (!defined.includes(identifier)) {
        defined.push(identifier);
      }
      return factorySpace(effects, whitespaceAfter, "gfmFootnoteDefinitionWhitespace");
    }
    return nok(code2);
  }
  function whitespaceAfter(code2) {
    return ok3(code2);
  }
}
function tokenizeDefinitionContinuation(effects, ok3, nok) {
  return effects.check(blankLine, ok3, effects.attempt(indent, ok3, nok));
}
function gfmFootnoteDefinitionEnd(effects) {
  effects.exit("gfmFootnoteDefinition");
}
function tokenizeIndent2(effects, ok3, nok) {
  const self = this;
  return factorySpace(effects, afterPrefix, "gfmFootnoteDefinitionIndent", constants.tabSize + 1);
  function afterPrefix(code2) {
    const tail = self.events[self.events.length - 1];
    return tail && tail[1].type === "gfmFootnoteDefinitionIndent" && tail[2].sliceSerialize(tail[1], true).length === constants.tabSize ? ok3(code2) : nok(code2);
  }
}
// node_modules/micromark-extension-gfm-strikethrough/dev/lib/syntax.js
function gfmStrikethrough(options) {
  const options_ = options || {};
  let single = options_.singleTilde;
  const tokenizer = {
    name: "strikethrough",
    tokenize: tokenizeStrikethrough,
    resolveAll: resolveAllStrikethrough
  };
  if (single === null || single === undefined) {
    single = true;
  }
  return {
    text: { [codes.tilde]: tokenizer },
    insideSpan: { null: [tokenizer] },
    attentionMarkers: { null: [codes.tilde] }
  };
  function resolveAllStrikethrough(events, context) {
    let index2 = -1;
    while (++index2 < events.length) {
      if (events[index2][0] === "enter" && events[index2][1].type === "strikethroughSequenceTemporary" && events[index2][1]._close) {
        let open = index2;
        while (open--) {
          if (events[open][0] === "exit" && events[open][1].type === "strikethroughSequenceTemporary" && events[open][1]._open && events[index2][1].end.offset - events[index2][1].start.offset === events[open][1].end.offset - events[open][1].start.offset) {
            events[index2][1].type = "strikethroughSequence";
            events[open][1].type = "strikethroughSequence";
            const strikethrough = {
              type: "strikethrough",
              start: Object.assign({}, events[open][1].start),
              end: Object.assign({}, events[index2][1].end)
            };
            const text4 = {
              type: "strikethroughText",
              start: Object.assign({}, events[open][1].end),
              end: Object.assign({}, events[index2][1].start)
            };
            const nextEvents = [
              ["enter", strikethrough, context],
              ["enter", events[open][1], context],
              ["exit", events[open][1], context],
              ["enter", text4, context]
            ];
            const insideSpan2 = context.parser.constructs.insideSpan.null;
            if (insideSpan2) {
              splice(nextEvents, nextEvents.length, 0, resolveAll(insideSpan2, events.slice(open + 1, index2), context));
            }
            splice(nextEvents, nextEvents.length, 0, [
              ["exit", text4, context],
              ["enter", events[index2][1], context],
              ["exit", events[index2][1], context],
              ["exit", strikethrough, context]
            ]);
            splice(events, open - 1, index2 - open + 3, nextEvents);
            index2 = open + nextEvents.length - 2;
            break;
          }
        }
      }
    }
    index2 = -1;
    while (++index2 < events.length) {
      if (events[index2][1].type === "strikethroughSequenceTemporary") {
        events[index2][1].type = types.data;
      }
    }
    return events;
  }
  function tokenizeStrikethrough(effects, ok3, nok) {
    const previous3 = this.previous;
    const events = this.events;
    let size = 0;
    return start;
    function start(code2) {
      ok(code2 === codes.tilde, "expected `~`");
      if (previous3 === codes.tilde && events[events.length - 1][1].type !== types.characterEscape) {
        return nok(code2);
      }
      effects.enter("strikethroughSequenceTemporary");
      return more(code2);
    }
    function more(code2) {
      const before = classifyCharacter(previous3);
      if (code2 === codes.tilde) {
        if (size > 1)
          return nok(code2);
        effects.consume(code2);
        size++;
        return more;
      }
      if (size < 2 && !single)
        return nok(code2);
      const token = effects.exit("strikethroughSequenceTemporary");
      const after = classifyCharacter(code2);
      token._open = !after || after === constants.attentionSideAfter && Boolean(before);
      token._close = !before || before === constants.attentionSideAfter && Boolean(after);
      return ok3(code2);
    }
  }
}
// node_modules/micromark-extension-gfm-table/dev/lib/edit-map.js
class EditMap {
  constructor() {
    this.map = [];
  }
  add(index2, remove, add) {
    addImplementation(this, index2, remove, add);
  }
  consume(events) {
    this.map.sort(function(a, b) {
      return a[0] - b[0];
    });
    if (this.map.length === 0) {
      return;
    }
    let index2 = this.map.length;
    const vecs = [];
    while (index2 > 0) {
      index2 -= 1;
      vecs.push(events.slice(this.map[index2][0] + this.map[index2][1]), this.map[index2][2]);
      events.length = this.map[index2][0];
    }
    vecs.push(events.slice());
    events.length = 0;
    let slice = vecs.pop();
    while (slice) {
      for (const element of slice) {
        events.push(element);
      }
      slice = vecs.pop();
    }
    this.map.length = 0;
  }
}
function addImplementation(editMap, at, remove, add) {
  let index2 = 0;
  if (remove === 0 && add.length === 0) {
    return;
  }
  while (index2 < editMap.map.length) {
    if (editMap.map[index2][0] === at) {
      editMap.map[index2][1] += remove;
      editMap.map[index2][2].push(...add);
      return;
    }
    index2 += 1;
  }
  editMap.map.push([at, remove, add]);
}

// node_modules/micromark-extension-gfm-table/dev/lib/infer.js
function gfmTableAlign(events, index2) {
  ok(events[index2][1].type === "table", "expected table");
  let inDelimiterRow = false;
  const align = [];
  while (index2 < events.length) {
    const event = events[index2];
    if (inDelimiterRow) {
      if (event[0] === "enter") {
        if (event[1].type === "tableContent") {
          align.push(events[index2 + 1][1].type === "tableDelimiterMarker" ? "left" : "none");
        }
      } else if (event[1].type === "tableContent") {
        if (events[index2 - 1][1].type === "tableDelimiterMarker") {
          const alignIndex = align.length - 1;
          align[alignIndex] = align[alignIndex] === "left" ? "center" : "right";
        }
      } else if (event[1].type === "tableDelimiterRow") {
        break;
      }
    } else if (event[0] === "enter" && event[1].type === "tableDelimiterRow") {
      inDelimiterRow = true;
    }
    index2 += 1;
  }
  return align;
}

// node_modules/micromark-extension-gfm-table/dev/lib/syntax.js
function gfmTable() {
  return {
    flow: {
      null: { name: "table", tokenize: tokenizeTable, resolveAll: resolveTable }
    }
  };
}
function tokenizeTable(effects, ok3, nok) {
  const self = this;
  let size = 0;
  let sizeB = 0;
  let seen;
  return start;
  function start(code2) {
    let index2 = self.events.length - 1;
    while (index2 > -1) {
      const type = self.events[index2][1].type;
      if (type === types.lineEnding || type === types.linePrefix)
        index2--;
      else
        break;
    }
    const tail = index2 > -1 ? self.events[index2][1].type : null;
    const next = tail === "tableHead" || tail === "tableRow" ? bodyRowStart : headRowBefore;
    if (next === bodyRowStart && self.parser.lazy[self.now().line]) {
      return nok(code2);
    }
    return next(code2);
  }
  function headRowBefore(code2) {
    effects.enter("tableHead");
    effects.enter("tableRow");
    return headRowStart(code2);
  }
  function headRowStart(code2) {
    if (code2 === codes.verticalBar) {
      return headRowBreak(code2);
    }
    seen = true;
    sizeB += 1;
    return headRowBreak(code2);
  }
  function headRowBreak(code2) {
    if (code2 === codes.eof) {
      return nok(code2);
    }
    if (markdownLineEnding(code2)) {
      if (sizeB > 1) {
        sizeB = 0;
        self.interrupt = true;
        effects.exit("tableRow");
        effects.enter(types.lineEnding);
        effects.consume(code2);
        effects.exit(types.lineEnding);
        return headDelimiterStart;
      }
      return nok(code2);
    }
    if (markdownSpace(code2)) {
      return factorySpace(effects, headRowBreak, types.whitespace)(code2);
    }
    sizeB += 1;
    if (seen) {
      seen = false;
      size += 1;
    }
    if (code2 === codes.verticalBar) {
      effects.enter("tableCellDivider");
      effects.consume(code2);
      effects.exit("tableCellDivider");
      seen = true;
      return headRowBreak;
    }
    effects.enter(types.data);
    return headRowData(code2);
  }
  function headRowData(code2) {
    if (code2 === codes.eof || code2 === codes.verticalBar || markdownLineEndingOrSpace(code2)) {
      effects.exit(types.data);
      return headRowBreak(code2);
    }
    effects.consume(code2);
    return code2 === codes.backslash ? headRowEscape : headRowData;
  }
  function headRowEscape(code2) {
    if (code2 === codes.backslash || code2 === codes.verticalBar) {
      effects.consume(code2);
      return headRowData;
    }
    return headRowData(code2);
  }
  function headDelimiterStart(code2) {
    self.interrupt = false;
    if (self.parser.lazy[self.now().line]) {
      return nok(code2);
    }
    effects.enter("tableDelimiterRow");
    seen = false;
    if (markdownSpace(code2)) {
      ok(self.parser.constructs.disable.null, "expected `disabled.null`");
      return factorySpace(effects, headDelimiterBefore, types.linePrefix, self.parser.constructs.disable.null.includes("codeIndented") ? undefined : constants.tabSize)(code2);
    }
    return headDelimiterBefore(code2);
  }
  function headDelimiterBefore(code2) {
    if (code2 === codes.dash || code2 === codes.colon) {
      return headDelimiterValueBefore(code2);
    }
    if (code2 === codes.verticalBar) {
      seen = true;
      effects.enter("tableCellDivider");
      effects.consume(code2);
      effects.exit("tableCellDivider");
      return headDelimiterCellBefore;
    }
    return headDelimiterNok(code2);
  }
  function headDelimiterCellBefore(code2) {
    if (markdownSpace(code2)) {
      return factorySpace(effects, headDelimiterValueBefore, types.whitespace)(code2);
    }
    return headDelimiterValueBefore(code2);
  }
  function headDelimiterValueBefore(code2) {
    if (code2 === codes.colon) {
      sizeB += 1;
      seen = true;
      effects.enter("tableDelimiterMarker");
      effects.consume(code2);
      effects.exit("tableDelimiterMarker");
      return headDelimiterLeftAlignmentAfter;
    }
    if (code2 === codes.dash) {
      sizeB += 1;
      return headDelimiterLeftAlignmentAfter(code2);
    }
    if (code2 === codes.eof || markdownLineEnding(code2)) {
      return headDelimiterCellAfter(code2);
    }
    return headDelimiterNok(code2);
  }
  function headDelimiterLeftAlignmentAfter(code2) {
    if (code2 === codes.dash) {
      effects.enter("tableDelimiterFiller");
      return headDelimiterFiller(code2);
    }
    return headDelimiterNok(code2);
  }
  function headDelimiterFiller(code2) {
    if (code2 === codes.dash) {
      effects.consume(code2);
      return headDelimiterFiller;
    }
    if (code2 === codes.colon) {
      seen = true;
      effects.exit("tableDelimiterFiller");
      effects.enter("tableDelimiterMarker");
      effects.consume(code2);
      effects.exit("tableDelimiterMarker");
      return headDelimiterRightAlignmentAfter;
    }
    effects.exit("tableDelimiterFiller");
    return headDelimiterRightAlignmentAfter(code2);
  }
  function headDelimiterRightAlignmentAfter(code2) {
    if (markdownSpace(code2)) {
      return factorySpace(effects, headDelimiterCellAfter, types.whitespace)(code2);
    }
    return headDelimiterCellAfter(code2);
  }
  function headDelimiterCellAfter(code2) {
    if (code2 === codes.verticalBar) {
      return headDelimiterBefore(code2);
    }
    if (code2 === codes.eof || markdownLineEnding(code2)) {
      if (!seen || size !== sizeB) {
        return headDelimiterNok(code2);
      }
      effects.exit("tableDelimiterRow");
      effects.exit("tableHead");
      return ok3(code2);
    }
    return headDelimiterNok(code2);
  }
  function headDelimiterNok(code2) {
    return nok(code2);
  }
  function bodyRowStart(code2) {
    effects.enter("tableRow");
    return bodyRowBreak(code2);
  }
  function bodyRowBreak(code2) {
    if (code2 === codes.verticalBar) {
      effects.enter("tableCellDivider");
      effects.consume(code2);
      effects.exit("tableCellDivider");
      return bodyRowBreak;
    }
    if (code2 === codes.eof || markdownLineEnding(code2)) {
      effects.exit("tableRow");
      return ok3(code2);
    }
    if (markdownSpace(code2)) {
      return factorySpace(effects, bodyRowBreak, types.whitespace)(code2);
    }
    effects.enter(types.data);
    return bodyRowData(code2);
  }
  function bodyRowData(code2) {
    if (code2 === codes.eof || code2 === codes.verticalBar || markdownLineEndingOrSpace(code2)) {
      effects.exit(types.data);
      return bodyRowBreak(code2);
    }
    effects.consume(code2);
    return code2 === codes.backslash ? bodyRowEscape : bodyRowData;
  }
  function bodyRowEscape(code2) {
    if (code2 === codes.backslash || code2 === codes.verticalBar) {
      effects.consume(code2);
      return bodyRowData;
    }
    return bodyRowData(code2);
  }
}
function resolveTable(events, context) {
  let index2 = -1;
  let inFirstCellAwaitingPipe = true;
  let rowKind = 0;
  let lastCell = [0, 0, 0, 0];
  let cell = [0, 0, 0, 0];
  let afterHeadAwaitingFirstBodyRow = false;
  let lastTableEnd = 0;
  let currentTable;
  let currentBody;
  let currentCell;
  const map = new EditMap;
  while (++index2 < events.length) {
    const event = events[index2];
    const token = event[1];
    if (event[0] === "enter") {
      if (token.type === "tableHead") {
        afterHeadAwaitingFirstBodyRow = false;
        if (lastTableEnd !== 0) {
          ok(currentTable, "there should be a table opening");
          flushTableEnd(map, context, lastTableEnd, currentTable, currentBody);
          currentBody = undefined;
          lastTableEnd = 0;
        }
        currentTable = {
          type: "table",
          start: Object.assign({}, token.start),
          end: Object.assign({}, token.end)
        };
        map.add(index2, 0, [["enter", currentTable, context]]);
      } else if (token.type === "tableRow" || token.type === "tableDelimiterRow") {
        inFirstCellAwaitingPipe = true;
        currentCell = undefined;
        lastCell = [0, 0, 0, 0];
        cell = [0, index2 + 1, 0, 0];
        if (afterHeadAwaitingFirstBodyRow) {
          afterHeadAwaitingFirstBodyRow = false;
          currentBody = {
            type: "tableBody",
            start: Object.assign({}, token.start),
            end: Object.assign({}, token.end)
          };
          map.add(index2, 0, [["enter", currentBody, context]]);
        }
        rowKind = token.type === "tableDelimiterRow" ? 2 : currentBody ? 3 : 1;
      } else if (rowKind && (token.type === types.data || token.type === "tableDelimiterMarker" || token.type === "tableDelimiterFiller")) {
        inFirstCellAwaitingPipe = false;
        if (cell[2] === 0) {
          if (lastCell[1] !== 0) {
            cell[0] = cell[1];
            currentCell = flushCell(map, context, lastCell, rowKind, undefined, currentCell);
            lastCell = [0, 0, 0, 0];
          }
          cell[2] = index2;
        }
      } else if (token.type === "tableCellDivider") {
        if (inFirstCellAwaitingPipe) {
          inFirstCellAwaitingPipe = false;
        } else {
          if (lastCell[1] !== 0) {
            cell[0] = cell[1];
            currentCell = flushCell(map, context, lastCell, rowKind, undefined, currentCell);
          }
          lastCell = cell;
          cell = [lastCell[1], index2, 0, 0];
        }
      }
    } else if (token.type === "tableHead") {
      afterHeadAwaitingFirstBodyRow = true;
      lastTableEnd = index2;
    } else if (token.type === "tableRow" || token.type === "tableDelimiterRow") {
      lastTableEnd = index2;
      if (lastCell[1] !== 0) {
        cell[0] = cell[1];
        currentCell = flushCell(map, context, lastCell, rowKind, index2, currentCell);
      } else if (cell[1] !== 0) {
        currentCell = flushCell(map, context, cell, rowKind, index2, currentCell);
      }
      rowKind = 0;
    } else if (rowKind && (token.type === types.data || token.type === "tableDelimiterMarker" || token.type === "tableDelimiterFiller")) {
      cell[3] = index2;
    }
  }
  if (lastTableEnd !== 0) {
    ok(currentTable, "expected table opening");
    flushTableEnd(map, context, lastTableEnd, currentTable, currentBody);
  }
  map.consume(context.events);
  index2 = -1;
  while (++index2 < context.events.length) {
    const event = context.events[index2];
    if (event[0] === "enter" && event[1].type === "table") {
      event[1]._align = gfmTableAlign(context.events, index2);
    }
  }
  return events;
}
function flushCell(map, context, range, rowKind, rowEnd, previousCell) {
  const groupName = rowKind === 1 ? "tableHeader" : rowKind === 2 ? "tableDelimiter" : "tableData";
  const valueName = "tableContent";
  if (range[0] !== 0) {
    ok(previousCell, "expected previous cell enter");
    previousCell.end = Object.assign({}, getPoint(context.events, range[0]));
    map.add(range[0], 0, [["exit", previousCell, context]]);
  }
  const now = getPoint(context.events, range[1]);
  previousCell = {
    type: groupName,
    start: Object.assign({}, now),
    end: Object.assign({}, now)
  };
  map.add(range[1], 0, [["enter", previousCell, context]]);
  if (range[2] !== 0) {
    const relatedStart = getPoint(context.events, range[2]);
    const relatedEnd = getPoint(context.events, range[3]);
    const valueToken = {
      type: valueName,
      start: Object.assign({}, relatedStart),
      end: Object.assign({}, relatedEnd)
    };
    map.add(range[2], 0, [["enter", valueToken, context]]);
    ok(range[3] !== 0);
    if (rowKind !== 2) {
      const start = context.events[range[2]];
      const end = context.events[range[3]];
      start[1].end = Object.assign({}, end[1].end);
      start[1].type = types.chunkText;
      start[1].contentType = constants.contentTypeText;
      if (range[3] > range[2] + 1) {
        const a = range[2] + 1;
        const b = range[3] - range[2] - 1;
        map.add(a, b, []);
      }
    }
    map.add(range[3] + 1, 0, [["exit", valueToken, context]]);
  }
  if (rowEnd !== undefined) {
    previousCell.end = Object.assign({}, getPoint(context.events, rowEnd));
    map.add(rowEnd, 0, [["exit", previousCell, context]]);
    previousCell = undefined;
  }
  return previousCell;
}
function flushTableEnd(map, context, index2, table, tableBody) {
  const exits = [];
  const related = getPoint(context.events, index2);
  if (tableBody) {
    tableBody.end = Object.assign({}, related);
    exits.push(["exit", tableBody, context]);
  }
  table.end = Object.assign({}, related);
  exits.push(["exit", table, context]);
  map.add(index2 + 1, 0, exits);
}
function getPoint(events, index2) {
  const event = events[index2];
  const side = event[0] === "enter" ? "start" : "end";
  return event[1][side];
}
// node_modules/micromark-extension-gfm-task-list-item/dev/lib/syntax.js
var tasklistCheck = { name: "tasklistCheck", tokenize: tokenizeTasklistCheck };
function gfmTaskListItem() {
  return {
    text: { [codes.leftSquareBracket]: tasklistCheck }
  };
}
function tokenizeTasklistCheck(effects, ok3, nok) {
  const self = this;
  return open;
  function open(code2) {
    ok(code2 === codes.leftSquareBracket, "expected `[`");
    if (self.previous !== codes.eof || !self._gfmTasklistFirstContentOfListItem) {
      return nok(code2);
    }
    effects.enter("taskListCheck");
    effects.enter("taskListCheckMarker");
    effects.consume(code2);
    effects.exit("taskListCheckMarker");
    return inside;
  }
  function inside(code2) {
    if (markdownLineEndingOrSpace(code2)) {
      effects.enter("taskListCheckValueUnchecked");
      effects.consume(code2);
      effects.exit("taskListCheckValueUnchecked");
      return close;
    }
    if (code2 === codes.uppercaseX || code2 === codes.lowercaseX) {
      effects.enter("taskListCheckValueChecked");
      effects.consume(code2);
      effects.exit("taskListCheckValueChecked");
      return close;
    }
    return nok(code2);
  }
  function close(code2) {
    if (code2 === codes.rightSquareBracket) {
      effects.enter("taskListCheckMarker");
      effects.consume(code2);
      effects.exit("taskListCheckMarker");
      effects.exit("taskListCheck");
      return after;
    }
    return nok(code2);
  }
  function after(code2) {
    if (markdownLineEnding(code2)) {
      return ok3(code2);
    }
    if (markdownSpace(code2)) {
      return effects.check({ tokenize: spaceThenNonSpace }, ok3, nok)(code2);
    }
    return nok(code2);
  }
}
function spaceThenNonSpace(effects, ok3, nok) {
  return factorySpace(effects, after, types.whitespace);
  function after(code2) {
    return code2 === codes.eof ? nok(code2) : ok3(code2);
  }
}
// node_modules/micromark-extension-gfm/index.js
function gfm(options) {
  return combineExtensions([
    gfmAutolinkLiteral(),
    gfmFootnote(),
    gfmStrikethrough(options),
    gfmTable(),
    gfmTaskListItem()
  ]);
}

// src/presets/issueMarkdown.ts
var HEADING_RE = /^(#{1,6})\s+(.+?)\s*$/;
var CHECKBOX_RE = /^(\s*)-\s+\[([ xX])\]\s+(.+)$/;
function normalizeTitle(title) {
  return title.trim().toLowerCase().replace(/\s+/g, " ");
}
function lineOffsets(text4) {
  const offsets = [0];
  for (let index2 = 0;index2 < text4.length; index2++) {
    if (text4[index2] === `
`)
      offsets.push(index2 + 1);
  }
  return offsets;
}
function assertSectionOrder(sectionOrder) {
  if (!Array.isArray(sectionOrder)) {
    throw new TypeError(`sectionOrder must be an array of section titles (e.g. ['Summary','Sources']), got ${typeof sectionOrder}`);
  }
}
function parseCheckboxItems(body, sectionLineStart) {
  const tree = fromMarkdown(body, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] });
  const items = [];
  const walk = (node2) => {
    if (node2.type === "listItem" && typeof node2.checked === "boolean" && node2.position) {
      const firstNested = (node2.children ?? []).find((c) => c.type === "list" && c.position);
      const start = node2.position.start.offset;
      const end = firstNested ? firstNested.position.start.offset : node2.position.end.offset;
      const itemBody = body.slice(start, end).replace(/^\s*-\s+\[[ xX]\]\s+/, "").replace(/\s+$/, "");
      const startLine = sectionLineStart + (node2.position.start.line - 1);
      const lastOwnLine = firstNested ? firstNested.position.start.line - 1 : node2.position.end.line;
      items.push({
        checked: node2.checked === true,
        marker: node2.checked ? "x" : " ",
        body: itemBody,
        lineStart: startLine,
        lineEnd: sectionLineStart + (Math.max(node2.position.start.line, lastOwnLine) - 1)
      });
    }
    for (const c of node2.children ?? [])
      walk(c);
  };
  walk(tree);
  return items;
}
function parseMarkdownDocument(text4) {
  text4 = text4.replace(/\r\n?/g, `
`);
  const offsets = lineOffsets(text4);
  const lines = text4.split(`
`);
  const tree = fromMarkdown(text4, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] });
  const headings = [];
  const collectHeadings = (node2) => {
    if (node2.type === "heading" && node2.position) {
      const offset = node2.position.start.offset;
      const raw = text4.slice(offset, node2.position.end.offset);
      const atx = /^(#{1,6})\s+(.*)$/.exec(raw);
      headings.push({
        level: node2.depth,
        title: (atx ? atx[2] : raw.split(`
`)[0]).trim(),
        line: node2.position.start.line,
        offset,
        raw
      });
    }
    for (const c of node2.children ?? [])
      collectHeadings(c);
  };
  collectHeadings(tree);
  const preambleEnd = headings[0]?.offset ?? text4.length;
  const sections = headings.map((heading, index2) => {
    const headingEnd = heading.offset + heading.raw.length;
    const bodyStart = text4[headingEnd] === `
` ? headingEnd + 1 : headingEnd;
    const nextHeading = headings.slice(index2 + 1).find((candidate) => candidate.level <= heading.level);
    const nextOffset = nextHeading?.offset ?? text4.length;
    const body = text4.slice(bodyStart, nextOffset).replace(/\n$/, "");
    const sectionLineStart = heading.line + 1 + (heading.raw.match(/\n/g)?.length ?? 0);
    let parentIndex = null;
    for (let candidateIndex = index2 - 1;candidateIndex >= 0; candidateIndex--) {
      if ((headings[candidateIndex]?.level ?? 0) < heading.level) {
        parentIndex = candidateIndex;
        break;
      }
    }
    const endLineIndex = offsets.findIndex((offset) => offset >= nextOffset);
    return {
      level: heading.level,
      title: heading.title.trim(),
      normalizedTitle: normalizeTitle(heading.title),
      body,
      raw: text4.slice(heading.offset, nextOffset),
      parentIndex,
      lineStart: heading.line,
      lineEnd: endLineIndex >= 0 ? endLineIndex : lines.length,
      checkboxItems: parseCheckboxItems(body, sectionLineStart)
    };
  });
  return {
    preamble: text4.slice(0, preambleEnd).replace(/\n$/, ""),
    rawPreamble: text4.slice(0, preambleEnd),
    sections,
    trailingNewline: text4.endsWith(`
`)
  };
}
var MARKDOWN_AC_PACK = {
  name: "markdown-ac",
  slotTitles: {
    summary: ["Summary"],
    acceptanceCriteria: ["Acceptance Criteria"],
    sources: ["Sources"],
    evidence: ["Evidence"]
  }
};
var GITHUB_FLAVORED_PACK = {
  name: "github-flavored",
  slotTitles: {
    ...MARKDOWN_AC_PACK.slotTitles,
    acceptanceCriteria: ["Acceptance Criteria", "Done When", "Definition of Done", "Tasks"],
    sources: ["Sources", "Context", "Background", "Motivation"],
    evidence: ["Evidence", "Verification", "Testing"]
  }
};
function slotSection(document4, slot, pack) {
  const titles = pack.slotTitles[slot];
  if (!titles || titles.length === 0)
    throw new Error(`grammar pack '${pack.name}' declares no titles for slot '${slot}'`);
  for (const title of titles) {
    const normalized = normalizeTitle(title);
    const found = document4.sections.find((section) => section.normalizedTitle === normalized);
    if (found)
      return found;
  }
  return null;
}
function childSectionsForTemplate(document4) {
  const titleSection = document4.sections.find((section) => section.level === 1 && section.parentIndex === null) ?? null;
  if (!titleSection)
    return document4.sections.filter((section) => section.parentIndex === null);
  const titleIndex = document4.sections.indexOf(titleSection);
  return document4.sections.filter((section) => section.parentIndex === titleIndex && section.level === 2);
}
function issueMarkdownDiagnostics(document4, sectionOrder) {
  const diagnostics = [];
  const h1Sections = document4.sections.filter((section) => section.level === 1 && section.parentIndex === null);
  if (document4.rawPreamble?.trim()) {
    diagnostics.push({
      level: "error",
      code: "issue_markdown_preamble_text",
      message: "Issue body has text before the title heading."
    });
  }
  if (h1Sections.length === 0) {
    diagnostics.push({
      level: "error",
      code: "issue_markdown_missing_title",
      message: "Issue body must start with a single # title heading."
    });
  } else if (h1Sections.length > 1) {
    diagnostics.push({
      level: "error",
      code: "issue_markdown_multiple_titles",
      message: "Issue body must have exactly one # title heading.",
      actual: h1Sections.map((section) => section.title)
    });
  }
  if (sectionOrder.length === 0)
    return diagnostics;
  const expected = sectionOrder;
  const expectedNormalized = new Set(expected.map(normalizeTitle));
  const actualSections = childSectionsForTemplate(document4);
  const actualCanonicalTitles = actualSections.filter((section) => expectedNormalized.has(section.normalizedTitle)).map((section) => section.title);
  const actualNormalized = actualSections.map((section) => section.normalizedTitle);
  for (const expectedTitle of expected) {
    if (!actualNormalized.includes(normalizeTitle(expectedTitle))) {
      diagnostics.push({
        level: "error",
        code: "issue_markdown_missing_section",
        message: `Issue body is missing required section ## ${expectedTitle}.`,
        section: expectedTitle,
        expected: [...expected],
        actual: actualSections.map((section) => section.title)
      });
    }
  }
  for (const section of actualSections) {
    if (!expectedNormalized.has(section.normalizedTitle)) {
      diagnostics.push({
        level: "error",
        code: "issue_markdown_unknown_section",
        message: `Issue body contains non-canonical section ## ${section.title}.`,
        section: section.title,
        line: section.lineStart,
        expected: [...expected]
      });
    }
  }
  const duplicateCounts = new Map;
  for (const section of actualSections.filter((candidate) => expectedNormalized.has(candidate.normalizedTitle))) {
    duplicateCounts.set(section.normalizedTitle, [...duplicateCounts.get(section.normalizedTitle) ?? [], section]);
  }
  for (const sections of duplicateCounts.values()) {
    if (sections.length <= 1)
      continue;
    diagnostics.push({
      level: "error",
      code: "issue_markdown_duplicate_section",
      message: `Issue body repeats section ## ${sections[0].title}.`,
      section: sections[0].title,
      actual: sections.map((section) => `line ${section.lineStart}`)
    });
  }
  if (JSON.stringify(actualCanonicalTitles) !== JSON.stringify(expected.filter((title) => actualNormalized.includes(normalizeTitle(title))))) {
    diagnostics.push({
      level: "error",
      code: "issue_markdown_section_order",
      message: "Issue body sections are not in canonical order.",
      expected: [...expected],
      actual: actualCanonicalTitles
    });
  }
  return diagnostics;
}
function parseIssueMarkdown(text4, sectionOrder = [], pack = MARKDOWN_AC_PACK) {
  assertSectionOrder(sectionOrder);
  const document4 = parseMarkdownDocument(text4);
  const sections = Object.fromEntries(Object.keys(pack.slotTitles).map((name) => [name, slotSection(document4, name, pack)]));
  return {
    document: document4,
    diagnostics: issueMarkdownDiagnostics(document4, sectionOrder),
    sections
  };
}
function canonicalizeBlockText(lines, startLine, protectedAbsLines) {
  const prot = lines.map((_, i) => protectedAbsLines.has(startLine + i));
  const rewritten = lines.map((line, i) => {
    if (prot[i])
      return line;
    const checkbox = CHECKBOX_RE.exec(line);
    if (checkbox) {
      const indent2 = checkbox[1] ?? "";
      const marker = (checkbox[2] ?? " ").toLowerCase() === "x" ? "x" : " ";
      return `${indent2}- [${marker}] ${(checkbox[3] ?? "").replace(/\s+$/, "")}`;
    }
    return line.replace(/\s+$/, "");
  });
  const collapsed = [];
  for (let i = 0;i < rewritten.length; i++) {
    const entry = { line: rewritten[i], prot: prot[i] };
    const prev = collapsed[collapsed.length - 1];
    if (entry.line === "" && !entry.prot && prev && prev.line === "" && !prev.prot)
      continue;
    collapsed.push(entry);
  }
  while (collapsed.length && collapsed[0].line === "" && !collapsed[0].prot)
    collapsed.shift();
  while (collapsed.length && collapsed[collapsed.length - 1].line === "" && !collapsed[collapsed.length - 1].prot)
    collapsed.pop();
  return collapsed.map((entry) => entry.line).join(`
`);
}
function canonicalizeIssueMarkdown(text4, sectionOrder = []) {
  assertSectionOrder(sectionOrder);
  text4 = text4.replace(/\r\n?/g, `
`);
  const canonicalSpelling = new Map(sectionOrder.map((title) => [normalizeTitle(title), title]));
  const lines = text4.split(`
`);
  const tree = fromMarkdown(text4, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] });
  const headingLines = new Set;
  const codeLines = new Set;
  const markNodes = (node2) => {
    if (node2.type === "heading" && node2.position)
      headingLines.add(node2.position.start.line);
    if (node2.type === "code" && node2.position) {
      for (let line = node2.position.start.line;line <= node2.position.end.line; line++)
        codeLines.add(line);
    }
    for (const c of node2.children ?? [])
      markNodes(c);
  };
  markNodes(tree);
  const blocks = [];
  const preamble = [];
  let current = null;
  for (let lineIndex = 0;lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex];
    const heading = headingLines.has(lineIndex + 1) ? HEADING_RE.exec(line) : null;
    if (heading) {
      current = { headingLevel: (heading[1] ?? "").length, title: (heading[2] ?? "").trim(), content: [], contentStart: lineIndex + 2 };
      blocks.push(current);
    } else if (current) {
      current.content.push(line);
    } else {
      preamble.push(line);
    }
  }
  const units = [];
  let unit = null;
  for (const block of blocks) {
    const ownContent = canonicalizeBlockText(block.content, block.contentStart, codeLines);
    if (block.headingLevel <= 2 || !unit) {
      const spelled = block.headingLevel === 2 ? canonicalSpelling.get(normalizeTitle(block.title)) : undefined;
      unit = {
        kind: block.headingLevel === 1 ? "title" : "section",
        title: spelled ?? block.title,
        level: Math.min(block.headingLevel, 6),
        parts: ownContent ? [ownContent] : []
      };
      units.push(unit);
    } else {
      const heading = `${"#".repeat(Math.min(block.headingLevel, 6))} ${block.title}`;
      unit.parts.push(ownContent ? `${heading}

${ownContent}` : heading);
    }
  }
  const titleUnit = units.find((candidate) => candidate.kind === "title") ?? null;
  const sectionUnits = units.filter((candidate) => candidate !== titleUnit && candidate.level === 2);
  const otherUnits = units.filter((candidate) => candidate !== titleUnit && candidate.level !== 2);
  const order = sectionOrder;
  const orderIndex = new Map(order.map((title, index2) => [normalizeTitle(title), index2]));
  const sorted = sectionUnits.map((candidate, index2) => ({ candidate, index: index2 })).sort((a, b) => {
    const rankA = orderIndex.get(normalizeTitle(a.candidate.title)) ?? order.length + a.index;
    const rankB = orderIndex.get(normalizeTitle(b.candidate.title)) ?? order.length + b.index;
    return rankA - rankB || a.index - b.index;
  }).map((entry) => entry.candidate);
  const rendered = [];
  const preambleText = canonicalizeBlockText(preamble, 1, codeLines);
  if (preambleText)
    rendered.push(preambleText);
  for (const candidate of titleUnit ? [titleUnit, ...sorted, ...otherUnits] : [...sorted, ...otherUnits]) {
    const heading = `${"#".repeat(candidate.level)} ${candidate.title}`;
    rendered.push([heading, ...candidate.parts].join(`

`));
  }
  return `${rendered.join(`

`)}
`;
}
// src/lint.ts
var LINT_RULES = {
  "todo-marker": { default: "warn", description: "TODO/FIXME/TBD left in a case record" },
  "placeholder-token": { default: "warn", description: "unfilled template token like <CASE>, <sha>, or lorem ipsum" },
  "unchecked-with-commit": { default: "warn", description: "unchecked AC row still carries a Commit: claim" }
};
var TODO_RE = /\b(TODO|FIXME|TBD)\b[:\s]/;
var PLACEHOLDER_RE = /<(CASE|ISSUE|sha|SHA|commit|placeholder|fill[- ]?in|your[- ][a-z]+)>|lorem ipsum/i;
var COMMIT_FIELD_RE = /\bcommit[:\s]+[0-9a-f]{7,40}\b/i;
function lintIssueBody(body, issue, config) {
  const rules = config?.organization?.lint?.rules ?? {};
  const severity = (rule) => rules[rule] ?? LINT_RULES[rule]?.default ?? "warn";
  const findings = [];
  const seen = new Set;
  const push2 = (rule, message, section, excerpt) => {
    const level = severity(rule);
    if (level === "off")
      return;
    const key = `${rule}|${issue ?? ""}|${excerpt ?? ""}`;
    if (seen.has(key))
      return;
    seen.add(key);
    findings.push({ severity: level, rule, message, ...issue ? { issue } : {}, ...section ? { section } : {}, ...excerpt ? { excerpt: excerpt.slice(0, 120) } : {} });
  };
  const parsed = parseIssueMarkdown(body);
  for (const section of parsed.document.sections) {
    if (section.level !== 2)
      continue;
    for (const line of section.body.split(`
`)) {
      const prose = line.replace(/`[^`]*`/g, "");
      if (TODO_RE.test(prose))
        push2("todo-marker", `Unresolved ${TODO_RE.exec(prose)?.[1]} marker.`, section.title, line.trim());
      if (PLACEHOLDER_RE.test(prose))
        push2("placeholder-token", "Unfilled template token.", section.title, line.trim());
    }
    for (const item of section.checkboxItems) {
      if (!item.checked && COMMIT_FIELD_RE.test(item.body)) {
        push2("unchecked-with-commit", "Unchecked AC still claims a commit — stale claim or forgotten checkbox.", section.title, item.body.split(`
`)[0]);
      }
    }
  }
  return findings;
}

// src/tx.ts
import { createHash as createHash2 } from "node:crypto";

// src/check.ts
function checkTrackerSnapshot2(rawSnapshot, options = {}) {
  const projectRoot = options.projectRoot ?? projectRootFrom();
  const config = options.config ?? loadTrackerConfig(projectRoot);
  const preset = resolveTrackerValidation(config, projectRoot);
  const checkSnapshot = preset.snapshot?.checkSnapshot;
  if (!checkSnapshot)
    throw new Error("Active tracker preset does not implement snapshot.checkSnapshot");
  return checkSnapshot(rawSnapshot, options);
}

// src/acVersion.ts
import { createHash } from "node:crypto";
var SOURCE_REF_RE = /(?<![A-Za-z])\[(?:source\s*)?(?<num>\d+)\]/gi;
var UPLOAD_REF_RE = /(?<path>(?:\.?\/)?uploads\/[^\s,)>\]]+\.(?:png|jpe?g|webp))/gi;
var EVIDENCE_REF_RE = /\[E(?<num>\d+)\]/g;
var PROOF_REF_RE = /\[P(?<num>\d+)\]/g;
var AC_VERSION_FIELD_RE = /\bAC-Version:\s*acv_[0-9a-f]{8,64}\b/gi;
var AC_STATUS_FIELD_RE = /\bstatus:\s*(pending|passed|failed|stale|blocked|descoped)\b/gi;
function acVersionFor(id, text4, sourceRefs, visibility) {
  const input = JSON.stringify({
    id,
    text: text4.trim().replace(/\s+/g, " "),
    sourceRefs: [...sourceRefs].sort(),
    ...visibility ? { visibility } : {}
  });
  return `acv_${createHash("sha256").update(input).digest("hex").slice(0, 12)}`;
}
function sourceRefs(text4) {
  return [...new Set([...text4.matchAll(SOURCE_REF_RE)].flatMap((match) => match.groups?.num ? [match.groups.num] : []))].sort();
}
function developmentVisibility(body) {
  return /\b(invisible|non[- ]?visible|cleanup|refactor|internal|backend|infrastructure|no visible ui|preserve existing behavior)\b/i.test(body) ? "invisible" : "visible";
}
function bodyWithoutAcStatus(body) {
  return body.replace(AC_STATUS_FIELD_RE, "").replace(/\s{2,}/g, " ").trim();
}
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function acceptanceCriterionText(body, id) {
  return bodyWithoutAcStatus(body).replace(new RegExp(`^\\s*${escapeRegExp(id)}\\s+`, "i"), "").replace(/\btype:\s*[a-z][a-z0-9_-]*\b/gi, "").replace(SOURCE_REF_RE, "").replace(EVIDENCE_REF_RE, "").replace(PROOF_REF_RE, "").replace(UPLOAD_REF_RE, "").replace(AC_VERSION_FIELD_RE, "").replace(/\bcommit[:\s]+[0-9a-f]{7,40}\b\.?/gi, "").replace(/\s+([.,;:])/g, "$1").replace(/\s{2,}/g, " ").trim();
}
function acVersionForItemBody(id, itemBody) {
  return acVersionFor(id, acceptanceCriterionText(itemBody, id), sourceRefs(itemBody), developmentVisibility(itemBody));
}

// src/export.ts
function activePreset(options) {
  const projectRoot = options.projectRoot ?? projectRootFrom();
  const config = loadTrackerConfig(projectRoot);
  return resolveTrackerValidation(config, projectRoot);
}
function exportTrackerSnapshot(options = {}) {
  const exportSnapshot = activePreset(options).snapshot?.exportSnapshot;
  if (!exportSnapshot)
    throw new Error("Active tracker preset does not implement snapshot.exportSnapshot");
  return exportSnapshot(options);
}

// src/mutate.ts
var AC_ID_IN_BODY_RE = /\b(?<prefix>AC[- ]?|case\/|dev\/|ext\/|proc\/)(?<num>\d{1,3})\b/i;
var STATUS_FIELD_RE = /\bstatus:\s*(pending|passed|failed|stale|blocked|descoped)\b/i;
var COMMIT_FIELD_RE2 = /\bcommit[:\s]+[0-9a-f]{7,40}\b\.?/gi;
var AC_VERSION_RE = /\s*\bAC-Version:\s*acv_[0-9a-f]{8,64}\b\.?/gi;
var EVIDENCE_REF_RE2 = /\s*\[E\d+\]/g;
var PROOF_REF_RE2 = /\s*\[P\d+\]/g;
function normalizedAcId(itemBody) {
  const match = AC_ID_IN_BODY_RE.exec(itemBody);
  if (!match?.groups)
    return null;
  const prefix = match.groups.prefix.toLowerCase().replace(" ", "-");
  const num = Number(match.groups.num);
  return prefix.endsWith("/") ? `${prefix}${String(num).padStart(2, "0")}` : `AC-${String(num).padStart(2, "0")}`;
}
function tidy(text4) {
  return text4.replace(/[ \t]{2,}/g, " ").replace(/[ \t]+([.,;:])/g, "$1").replace(/[ \t]+$/gm, "").trim();
}
function setStatusField(itemBody, acId, status) {
  if (STATUS_FIELD_RE.test(itemBody))
    return itemBody.replace(STATUS_FIELD_RE, `status: ${status}`);
  const idMatch = AC_ID_IN_BODY_RE.exec(itemBody);
  if (idMatch && idMatch.index !== undefined) {
    const end = idMatch.index + idMatch[0].length;
    return `${itemBody.slice(0, end)} status: ${status}${itemBody.slice(end)}`;
  }
  return `${acId} status: ${status} ${itemBody}`;
}
function checkItem(itemBody, acId, mutation) {
  let body = setStatusField(itemBody, acId, "passed");
  if (mutation.commit) {
    if (/\bcommit[:\s]+[0-9a-f]{7,40}\b/i.test(body)) {
      body = body.replace(/\b(commit[:\s]+)[0-9a-f]{7,40}\b/i, (_full, label) => `${label}${mutation.commit}`);
    } else {
      const tidied = tidy(body);
      body = `${tidied}${/[.!?\]]$/.test(tidied) ? "" : "."} Commit: ${mutation.commit}.`;
    }
  }
  for (const ref of mutation.evidence ?? []) {
    if (!body.includes(`[${ref}]`))
      body = `${body} [${ref}]`;
  }
  for (const ref of mutation.proof ?? []) {
    if (!body.includes(`[${ref}]`))
      body = `${body} [${ref}]`;
  }
  body = tidy(body);
  if (mutation.anchor !== false) {
    const stripped = tidy(body.replace(AC_VERSION_RE, " "));
    body = `${stripped} AC-Version: ${acVersionForItemBody(acId, stripped)}`;
  }
  return tidy(body);
}
function uncheckItem(itemBody, acId) {
  let body = itemBody.replace(COMMIT_FIELD_RE2, " ");
  body = body.replace(AC_VERSION_RE, " ");
  body = body.replace(EVIDENCE_REF_RE2, "");
  body = body.replace(PROOF_REF_RE2, "");
  body = setStatusField(tidy(body), acId, "pending");
  return tidy(body);
}
function addEvidenceEntry(rawBody, spec) {
  const canonical = canonicalizeIssueMarkdown(rawBody);
  const existingNums = [...canonical.matchAll(/^\s*\[E(\d+)\]/gm)].map((match) => Number(match[1]));
  const id = `E${(existingNums.length ? Math.max(...existingNums) : 0) + 1}`;
  const fields = [`type: ${spec.type}`];
  const push2 = (name, value) => {
    if (value)
      fields.push(`${name}: ${value}`);
  };
  push2("repo", spec.repo);
  push2("number", spec.number);
  push2("head", spec.head);
  push2("state", spec.state);
  push2("path", spec.path);
  push2("url", spec.url);
  push2("blob", spec.blob);
  push2("status", spec.status);
  push2("ac", spec.ac);
  push2("justification", spec.justification);
  const entryLine = `[${id}] ${fields.join(" ")}`;
  const lines = canonical.split(`
`);
  const evidenceHeadingIdx = lines.findIndex((line) => /^#{1,6}\s+Evidence\s*$/i.test(line));
  if (evidenceHeadingIdx === -1) {
    const trimmed = canonical.replace(/\n+$/, "");
    return { body: canonicalizeIssueMarkdown(`${trimmed}

## Evidence

${entryLine}
`), evidenceId: id };
  }
  let sectionEnd = lines.length;
  for (let i = evidenceHeadingIdx + 1;i < lines.length; i++) {
    if (/^#{1,6}\s+/.test(lines[i])) {
      sectionEnd = i;
      break;
    }
  }
  let insertAt = evidenceHeadingIdx + 1;
  for (let i = evidenceHeadingIdx + 1;i < sectionEnd; i++) {
    if (/^\s*\[E\d+\]/.test(lines[i]))
      insertAt = i + 1;
  }
  lines.splice(insertAt, 0, entryLine);
  return { body: canonicalizeIssueMarkdown(lines.join(`
`)), evidenceId: id };
}
function applyAcMutation(rawBody, mutation) {
  const canonical = canonicalizeIssueMarkdown(rawBody);
  const document4 = parseMarkdownDocument(canonical);
  const targetId = (normalizedAcId(mutation.acId) ?? mutation.acId).toLowerCase();
  const seenLines = new Set;
  const matches = [];
  for (const section of document4.sections) {
    for (const item2 of section.checkboxItems) {
      if (normalizedAcId(item2.body)?.toLowerCase() !== targetId)
        continue;
      if (seenLines.has(item2.lineStart))
        continue;
      seenLines.add(item2.lineStart);
      matches.push({ item: item2 });
    }
  }
  if (matches.length === 0)
    throw new Error(`AC ${mutation.acId} not found in issue body`);
  if (matches.length > 1)
    throw new Error(`AC ${mutation.acId} is ambiguous: ${matches.length} checkbox rows carry this id`);
  const item = matches[0].item;
  const canonicalId = normalizedAcId(item.body) ?? mutation.acId;
  const lines = canonical.split(`
`);
  const bodyLines = item.body.split(`
`);
  const firstLine = bodyLines[0] ?? "";
  const restLines = bodyLines.slice(1);
  let newChecked = item.checked;
  let newFirst = firstLine;
  if (mutation.op === "check") {
    newChecked = true;
    newFirst = checkItem(firstLine, canonicalId, mutation);
  } else if (mutation.op === "uncheck") {
    newChecked = false;
    newFirst = uncheckItem(firstLine, canonicalId);
  } else {
    newChecked = mutation.status === "passed" ? true : mutation.status === "pending" ? false : item.checked;
    newFirst = tidy(setStatusField(firstLine, canonicalId, mutation.status));
  }
  const newBody = [newFirst, ...restLines].join(`
`);
  const indentMatch = /^(\s*)-/.exec(lines[item.lineStart - 1] ?? "");
  const indent2 = indentMatch?.[1] ?? "";
  const rendered = [`${indent2}- [${newChecked ? "x" : " "}] ${newFirst}`, ...restLines];
  lines.splice(item.lineStart - 1, bodyLines.length, ...rendered);
  const body = canonicalizeIssueMarkdown(lines.join(`
`));
  return {
    body,
    changed: body !== canonical,
    acId: mutation.acId,
    itemBefore: item.body,
    itemAfter: newBody
  };
}

// src/backends/local.ts
import { spawn } from "node:child_process";
function run(cmd, args, options) {
  return new Promise((resolve3, reject) => {
    const proc = spawn(cmd, args, { cwd: options.cwd, env: options.env, stdio: ["pipe", "pipe", "pipe"] });
    const stdout = [];
    const stderr = [];
    proc.stdout.on("data", (chunk) => stdout.push(chunk));
    proc.stderr.on("data", (chunk) => stderr.push(chunk));
    proc.on("error", reject);
    proc.on("close", (code2, signal) => {
      const result = {
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8")
      };
      if (code2 === 0) {
        resolve3(result);
        return;
      }
      const detail = [result.stderr.trim(), result.stdout.trim()].filter(Boolean).join(`
`);
      reject(new Error(detail || `${cmd} ${args.join(" ")} exited with ${signal ? `signal ${signal}` : `code ${code2}`}`));
    });
    if (options.inputText)
      proc.stdin.end(options.inputText);
    else
      proc.stdin.end();
  });
}

class LocalBackend {
  name = "local";
  projectRoot;
  constructor(projectRoot) {
    this.projectRoot = projectRoot;
  }
  command(args, inputText) {
    return run("python3", [trackerBackendScriptPath(), ...args], {
      cwd: this.projectRoot,
      inputText,
      env: {
        ...process.env,
        PROJECT_ROOT: this.projectRoot,
        CONFIG_FILE: trackerConfigPath(this.projectRoot)
      }
    });
  }
}
function createLocalBackend(_name, projectRoot) {
  return new LocalBackend(projectRoot);
}

// src/backends/markdownBackend.ts
import { existsSync as existsSync3, mkdirSync as mkdirSync2, readFileSync as readFileSync2, readdirSync, writeFileSync as writeFileSync2 } from "node:fs";
import { join as join2 } from "node:path";

// src/backends/markdown.ts
var COMMENTS_MARKER = "<!--tracker:comments";
function fmLine(key, value) {
  if (value === null || value === undefined)
    return null;
  if (Array.isArray(value) && value.length === 0)
    return null;
  if (typeof value === "string" && value === "")
    return null;
  return `${key}: ${JSON.stringify(value)}`;
}
function serializeIssue(c) {
  const fm = [
    fmLine("identifier", c.identifier),
    fmLine("title", c.title),
    fmLine("state", c.state),
    fmLine("stateType", c.stateType),
    fmLine("assignees", c.assignees),
    fmLine("labels", c.labels),
    fmLine("project", c.project),
    fmLine("parent", c.parent),
    fmLine("children", c.children),
    fmLine("branchName", c.branchName),
    fmLine("priority", c.priority),
    `devProgress: ${JSON.stringify(c.devProgress)}`,
    fmLine("createdAt", c.createdAt),
    fmLine("updatedAt", c.updatedAt),
    fmLine("completedAt", c.completedAt),
    fmLine("canceledAt", c.canceledAt),
    fmLine("url", c.url)
  ].filter((l) => l !== null).join(`
`);
  return `---
${fm}
---
${c.body}
${COMMENTS_MARKER}
${JSON.stringify(c.comments)}
-->
`;
}
function parseIssue(md) {
  const fmM = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(md);
  const fm = {};
  if (fmM)
    for (const raw of fmM[1].split(`
`)) {
      const m = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(raw);
      if (m) {
        try {
          fm[m[1]] = JSON.parse(m[2]);
        } catch {
          fm[m[1]] = m[2];
        }
      }
    }
  const rest = fmM ? md.slice(fmM[0].length) : md;
  const cIdx = rest.lastIndexOf(`
${COMMENTS_MARKER}`);
  const body = cIdx >= 0 ? rest.slice(0, cIdx) : rest.replace(/\n$/, "");
  let comments = [];
  if (cIdx >= 0) {
    const cm = /<!--tracker:comments\r?\n([\s\S]*?)\r?\n-->/.exec(rest.slice(cIdx));
    if (cm) {
      try {
        comments = JSON.parse(cm[1]);
      } catch {
        comments = [];
      }
    }
  }
  const sA = (k) => typeof fm[k] === "string" ? fm[k] : "";
  const arr = (k) => Array.isArray(fm[k]) ? fm[k] : [];
  return {
    identifier: sA("identifier"),
    title: sA("title"),
    body,
    state: sA("state"),
    stateType: sA("stateType"),
    assignees: arr("assignees"),
    labels: arr("labels"),
    project: fm.project ?? null,
    parent: fm.parent ?? null,
    children: arr("children"),
    branchName: sA("branchName"),
    priority: typeof fm.priority === "number" ? fm.priority : 0,
    devProgress: "devProgress" in fm ? fm.devProgress : null,
    createdAt: sA("createdAt"),
    updatedAt: sA("updatedAt"),
    completedAt: fm.completedAt ?? null,
    canceledAt: fm.canceledAt ?? null,
    url: sA("url"),
    comments
  };
}

// src/backends/markdownBackend.ts
function storeDir(projectRoot) {
  return join2(projectRoot, ".volter", "tracker", "markdown");
}
function issueFile(dir, id) {
  return join2(dir, `${id}.md`);
}
function loadAll(dir) {
  if (!existsSync3(dir))
    return [];
  return readdirSync(dir).filter((f) => f.endsWith(".md")).map((f) => parseIssue(readFileSync2(join2(dir, f), "utf8")));
}
function loadOne(dir, id) {
  const p = issueFile(dir, id);
  return existsSync3(p) ? parseIssue(readFileSync2(p, "utf8")) : null;
}
function viewJson(c) {
  return {
    id: c.identifier,
    identifier: c.identifier,
    number: c.identifier,
    title: c.title,
    branchName: c.branchName,
    description: c.body,
    body: c.body,
    state: { name: c.state, type: c.stateType },
    stateType: c.stateType,
    devProgress: c.devProgress,
    priority: c.priority,
    url: c.url,
    labels: { nodes: c.labels.map((name) => ({ name })) },
    assignee: c.assignees.length ? { name: c.assignees[0] } : null,
    assignees: { nodes: c.assignees.map((name) => ({ name })) },
    project: c.project ? { id: c.project } : null,
    parent: c.parent ? { id: c.parent, identifier: c.parent } : null,
    children: { nodes: c.children.map((identifier) => ({ identifier })) },
    comments: { nodes: c.comments.map((cc) => ({ body: cc.body, createdAt: cc.createdAt, user: { name: cc.user } })) },
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    completedAt: c.completedAt,
    canceledAt: c.canceledAt
  };
}
function listRow(c, fields) {
  const all2 = {
    id: c.identifier,
    identifier: c.identifier,
    number: c.identifier,
    title: c.title,
    body: c.body,
    description: c.body,
    state: c.state,
    stateType: c.stateType,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    project: c.project,
    parent: c.parent ?? "",
    labels: c.labels,
    url: c.url,
    priority: c.priority,
    assignee: c.assignees[0] ?? "",
    branchName: c.branchName
  };
  const row = {};
  for (const f of fields)
    row[f] = all2[f] ?? null;
  return row;
}
function flagVal(args, name) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}
function flagAll(args, name) {
  const out = [];
  for (let i = 0;i < args.length; i += 1)
    if (args[i] === `--${name}`)
      out.push(args[i + 1]);
  return out;
}
var ok3 = (stdout) => ({ stdout, stderr: "" });

class MarkdownBackend {
  name = "markdown";
  dir;
  teamKey;
  constructor(projectRoot, teamKey) {
    this.dir = storeDir(projectRoot);
    this.teamKey = teamKey;
    mkdirSync2(this.dir, { recursive: true });
  }
  async command(args) {
    const [verb, sub, ...rest] = args;
    if (verb === "issue" && sub === "list") {
      const fields = (flagVal(args, "json") ?? "identifier").split(",").map((s) => s.trim()).filter(Boolean);
      let rows = loadAll(this.dir);
      const state = flagVal(args, "state");
      if (state)
        rows = rows.filter((c) => c.state === state);
      const label = flagVal(args, "label");
      if (label)
        rows = rows.filter((c) => c.labels.includes(label));
      const parent = flagVal(args, "parent");
      if (parent)
        rows = rows.filter((c) => c.parent === parent);
      const search2 = flagVal(args, "search");
      if (search2)
        rows = rows.filter((c) => `${c.title}
${c.body}`.toLowerCase().includes(search2.toLowerCase()));
      const limit = flagVal(args, "limit");
      const limitN = Number(limit);
      if (limit && Number.isFinite(limitN) && limitN >= 0)
        rows = rows.slice(0, limitN);
      return ok3(JSON.stringify(rows.map((c) => listRow(c, fields)), null, 2));
    }
    if (verb === "issue" && sub === "view") {
      const c = loadOne(this.dir, rest[0]);
      if (!c)
        return { stdout: "", stderr: `issue ${rest[0]} not found` };
      if (!args.includes("--json"))
        return ok3(c.body);
      const seen = new Set;
      const fullView = (issue) => {
        const v = viewJson(issue);
        v.children = { nodes: issue.children.map((cid) => {
          if (seen.has(cid))
            return { id: cid, identifier: cid, number: cid };
          seen.add(cid);
          const ch = loadOne(this.dir, cid);
          return ch ? fullView(ch) : { id: cid, identifier: cid, number: cid };
        }) };
        return v;
      };
      return ok3(JSON.stringify(fullView(c), null, 2));
    }
    if (verb === "issue" && sub === "create") {
      const id = `${this.teamKey}-${loadAll(this.dir).reduce((m, c2) => Math.max(m, Number(c2.identifier.split("-").pop()) || 0), 0) + 1}`;
      const now = new Date().toISOString();
      const c = {
        identifier: id,
        title: flagVal(args, "title") ?? "",
        body: flagVal(args, "body") ?? "",
        state: flagVal(args, "state") ?? "Backlog",
        stateType: "open",
        assignees: flagVal(args, "assignee") ? [flagVal(args, "assignee")] : [],
        labels: flagAll(args, "label"),
        project: flagVal(args, "project") ?? null,
        parent: flagVal(args, "parent") ?? null,
        children: [],
        branchName: "",
        priority: 0,
        devProgress: "",
        createdAt: now,
        updatedAt: now,
        completedAt: null,
        canceledAt: null,
        url: `local://tracker/issue/${id}`,
        comments: []
      };
      writeFileSync2(issueFile(this.dir, id), serializeIssue(c));
      return ok3(JSON.stringify(viewJson(c), null, 2));
    }
    if (verb === "issue" && sub === "edit") {
      const c = loadOne(this.dir, rest[0]);
      if (!c)
        return { stdout: "", stderr: `issue ${rest[0]} not found` };
      const t = flagVal(args, "title");
      if (t)
        c.title = t;
      const b = flagVal(args, "body");
      if (b !== undefined)
        c.body = b;
      const s = flagVal(args, "state");
      if (s)
        c.state = s;
      const p = flagVal(args, "project");
      if (p)
        c.project = p;
      if (args.includes("--remove-project"))
        c.project = null;
      const pa = flagVal(args, "parent");
      if (pa)
        c.parent = pa;
      if (args.includes("--remove-parent"))
        c.parent = null;
      for (const l of flagAll(args, "add-label"))
        if (!c.labels.includes(l))
          c.labels.push(l);
      const rm = new Set(flagAll(args, "remove-label"));
      c.labels = c.labels.filter((l) => !rm.has(l));
      c.updatedAt = new Date().toISOString();
      writeFileSync2(issueFile(this.dir, c.identifier), serializeIssue(c));
      return ok3(JSON.stringify(viewJson(c), null, 2));
    }
    if (verb === "issue" && sub === "comment") {
      const c = loadOne(this.dir, rest[0]);
      if (!c)
        return { stdout: "", stderr: `issue ${rest[0]} not found` };
      c.comments.push({ user: "local", createdAt: new Date().toISOString(), body: flagVal(args, "body") ?? "" });
      c.updatedAt = new Date().toISOString();
      writeFileSync2(issueFile(this.dir, c.identifier), serializeIssue(c));
      return ok3("");
    }
    if (verb === "issue" && sub === "close") {
      const c = loadOne(this.dir, rest[0]);
      if (!c)
        return { stdout: "", stderr: `issue ${rest[0]} not found` };
      const canceled = flagVal(args, "reason") === "canceled";
      c.state = canceled ? "Canceled" : "Done";
      c.stateType = canceled ? "canceled" : "completed";
      const now = new Date().toISOString();
      c.updatedAt = now;
      if (canceled)
        c.canceledAt = now;
      else
        c.completedAt = now;
      const cmt = flagVal(args, "comment");
      if (cmt)
        c.comments.push({ user: "local", createdAt: now, body: cmt });
      writeFileSync2(issueFile(this.dir, c.identifier), serializeIssue(c));
      return ok3("");
    }
    if (verb === "project" && sub === "list")
      return ok3("[]");
    if (verb === "snapshot")
      return { stdout: "", stderr: "snapshot is not yet implemented for the markdown backend (build the snapshot on issue list/view)" };
    return { stdout: "", stderr: `markdown backend: unsupported command "${args.join(" ")}"` };
  }
}
function createMarkdownBackend(projectRoot, teamKey) {
  return new MarkdownBackend(projectRoot, teamKey);
}

// src/graphql.ts
function findCall(query, name) {
  const match = new RegExp(`\\b${name}\\s*\\(`).exec(query);
  if (!match)
    return null;
  let depth = 1;
  let i = match.index + match[0].length;
  let inString = false;
  let escaped = false;
  const start = i;
  while (i < query.length) {
    const ch = query[i];
    if (inString) {
      if (escaped)
        escaped = false;
      else if (ch === "\\")
        escaped = true;
      else if (ch === '"')
        inString = false;
    } else if (ch === '"')
      inString = true;
    else if (ch === "(")
      depth += 1;
    else if (ch === ")") {
      depth -= 1;
      if (depth === 0)
        return query.slice(start, i);
    }
    i += 1;
  }
  return null;
}
function argString(args, name) {
  const match = new RegExp(`\\b${name}\\s*:\\s*"((?:\\\\.|[^"])*)"`, "s").exec(args);
  return match ? JSON.parse(`"${match[1]}"`) : undefined;
}
function argInt(args, name, fallback) {
  const match = new RegExp(`\\b${name}\\s*:\\s*(\\d+)`).exec(args);
  return match ? Number(match[1]) : fallback;
}
function argStringList(args, name) {
  const match = new RegExp(`\\b${name}\\s*:\\s*\\[(.*?)\\]`, "s").exec(args);
  if (!match)
    return [];
  return [...match[1].matchAll(/"((?:\\.|[^"])*)"/g)].map((item) => JSON.parse(`"${item[1]}"`));
}
function labelsFromFilter(args) {
  const match = /\blabels\s*:\s*\{\s*includes\s*:\s*\[(.*?)\]/s.exec(args);
  if (!match)
    return [];
  return [...match[1].matchAll(/"((?:\\.|[^"])*)"/g)].map((item) => JSON.parse(`"${item[1]}"`));
}
function inputBlock(query, name) {
  const call = findCall(query, name) ?? "";
  const match = /\binput\s*:\s*\{/.exec(call);
  if (!match)
    return call;
  let depth = 1;
  let i = match.index + match[0].length;
  const start = i;
  let inString = false;
  let escaped = false;
  while (i < call.length) {
    const ch = call[i];
    if (inString) {
      if (escaped)
        escaped = false;
      else if (ch === "\\")
        escaped = true;
      else if (ch === '"')
        inString = false;
    } else if (ch === '"')
      inString = true;
    else if (ch === "{")
      depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0)
        return call.slice(start, i);
    }
    i += 1;
  }
  return call.slice(start);
}
function identifierFromCreateOutput(stdout) {
  const trimmed = stdout.trim();
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === "object" && typeof parsed.identifier === "string") {
      return parsed.identifier;
    }
  } catch {}
  return trimmed.split(/\s+/)[0] ?? "";
}
function parseJson(stdout) {
  return JSON.parse(stdout || "null");
}
function normalizeIssue(value) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return null;
  const issue = value;
  const identifier = String(issue.identifier ?? issue.number ?? "");
  if (!identifier)
    return null;
  const rawLabels = issue.labels;
  const labels = Array.isArray(rawLabels) ? rawLabels.map((label) => typeof label === "object" && label ? label : { name: String(label) }) : rawLabels && typeof rawLabels === "object" && ("nodes" in rawLabels) ? rawLabels.nodes ?? [] : [];
  const state = issue.state && typeof issue.state === "object" ? issue.state : { name: issue.state, type: issue.stateType };
  const parent = typeof issue.parent === "string" ? { id: issue.parent, identifier: issue.parent } : issue.parent;
  const project = typeof issue.project === "string" ? { id: issue.project, name: issue.project } : issue.project;
  return {
    ...issue,
    id: issue.id ?? identifier,
    identifier,
    number: identifier,
    body: issue.body ?? issue.description,
    description: issue.description ?? issue.body,
    state,
    stateType: issue.stateType ?? state.type,
    parent,
    project,
    labels: { nodes: labels },
    comments: issue.comments && typeof issue.comments === "object" && "nodes" in issue.comments ? issue.comments : { nodes: Array.isArray(issue.comments) ? issue.comments : [] }
  };
}
async function commandJson(backend, args) {
  return parseJson((await backend.command(args)).stdout);
}
async function executeTrackerGraphql(backend, query, _variables = {}) {
  if (backend.name === "local") {
    return parseJson((await backend.command(["api", "query", "--query", query])).stdout);
  }
  if (/\bissueCreate\b/.test(query)) {
    const data = inputBlock(query, "issueCreate");
    const title = argString(data, "title");
    if (!title)
      return { data: { issueCreate: { success: false, issue: null } } };
    const args = ["issue", "create", "--title", title];
    const body = argString(data, "body") ?? argString(data, "description");
    const state = argString(data, "state");
    const parent = argString(data, "parent");
    const project = argString(data, "project");
    const labels = labelsFromFilter(data).concat(argStringList(data, "labels"));
    if (body)
      args.push("--body", body);
    if (state)
      args.push("--state", state);
    if (parent)
      args.push("--parent", parent);
    if (project)
      args.push("--project", project);
    for (const label of labels)
      args.push("--label", label);
    const out = (await backend.command(args)).stdout.trim();
    const identifier = identifierFromCreateOutput(out);
    const issue = normalizeIssue(await commandJson(backend, ["issue", "view", identifier, "--comments", "--json"]));
    return { data: { issueCreate: { success: Boolean(issue), issue } } };
  }
  if (/\bcommentCreate\b/.test(query)) {
    const data = inputBlock(query, "commentCreate");
    const issue = argString(data, "issueId") ?? argString(data, "issue");
    const body = argString(data, "body");
    if (!issue || !body)
      return { data: { commentCreate: { success: false, comment: null } } };
    await backend.command(["issue", "comment", issue, "--body", body]);
    return { data: { commentCreate: { success: true, comment: { body } } } };
  }
  if (/\bsnapshot\b/.test(query)) {
    return { data: { snapshot: await commandJson(backend, ["snapshot", "project-manager", "--format", "json"]) } };
  }
  const issueArgs = findCall(query, "issue");
  if (issueArgs) {
    const id = argString(issueArgs, "id") ?? argString(issueArgs, "identifier");
    const issue = id ? normalizeIssue(await commandJson(backend, ["issue", "view", id, "--comments", "--json"])) : null;
    return { data: { issue } };
  }
  const issuesArgs = findCall(query, "issues");
  if (issuesArgs) {
    const firstArg = argInt(issuesArgs, "first", 0);
    const args = ["issue", "list", ...firstArg > 0 ? ["--limit", String(firstArg)] : [], "--json", "id,identifier,number,title,body,description,state,stateType,createdAt,updatedAt,project,parent,labels,url,priority"];
    const state = argString(issuesArgs, "state");
    const text4 = argString(issuesArgs, "text");
    if (state)
      args.push("--state", state);
    if (text4)
      args.push("--search", text4);
    for (const label of labelsFromFilter(issuesArgs))
      args.push("--label", label);
    const issues = await commandJson(backend, args);
    const nodes = Array.isArray(issues) ? issues.map(normalizeIssue).filter(Boolean) : [];
    return { data: { issues: { nodes } } };
  }
  const projectsArgs = findCall(query, "projects");
  if (projectsArgs) {
    const projects = await commandJson(backend, ["project", "list", "--json", "id,name,status,state,progress,targetDate"]);
    return { data: { projects: { nodes: Array.isArray(projects) ? projects.slice(0, argInt(projectsArgs, "first", 50)) : [] } } };
  }
  return { errors: [{ message: "Unsupported tracker GraphQL query root" }] };
}

// src/sdk.ts
function parseJsonOrText(stdout) {
  const text4 = stdout.trim();
  if (!text4)
    return null;
  try {
    return JSON.parse(text4);
  } catch {
    return text4;
  }
}
function identifierFromCreateOutput2(stdout) {
  const trimmed = stdout.trim();
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === "object" && typeof parsed.identifier === "string") {
      return parsed.identifier;
    }
  } catch {}
  return trimmed.split(/\s+/)[0] ?? "";
}
function issueCreateArgs(input) {
  const args = ["issue", "create", "--title", input.title];
  if (input.body)
    args.push("--body", input.body);
  if (input.state)
    args.push("--state", input.state);
  if (input.assignee)
    args.push("--assignee", input.assignee);
  if (input.parent)
    args.push("--parent", input.parent);
  if (input.project)
    args.push("--project", input.project);
  for (const label of input.labels ?? [])
    args.push("--label", label);
  return args;
}
function issueEditArgs(identifier, input) {
  const args = ["issue", "edit", identifier];
  if (input.title)
    args.push("--title", input.title);
  if (input.body !== undefined)
    args.push("--body", input.body);
  if (input.state)
    args.push("--state", input.state);
  if (input.project)
    args.push("--project", input.project);
  if (input.removeProject)
    args.push("--remove-project");
  if (input.parent)
    args.push("--parent", input.parent);
  if (input.removeParent)
    args.push("--remove-parent");
  for (const label of input.addLabels ?? [])
    args.push("--add-label", label);
  for (const label of input.removeLabels ?? [])
    args.push("--remove-label", label);
  return args;
}
function createTrackerClient(options = {}) {
  const projectRoot = options.projectRoot ?? projectRootFrom();
  loadEnvFiles(projectRoot);
  const config = loadTrackerConfig(projectRoot);
  const backend = config.backend === "markdown" ? createMarkdownBackend(projectRoot, config.local?.teamKey ?? "PH") : createLocalBackend(config.backend, projectRoot);
  return {
    command(args, inputText) {
      return backend.command(args, inputText);
    },
    async graphql(query, variables) {
      return executeTrackerGraphql(backend, query, variables);
    },
    issue: {
      async list(options2 = {}) {
        const args = ["issue", "list"];
        if (options2.state)
          args.push("--state", options2.state);
        if (options2.search)
          args.push("--search", options2.search);
        if (options2.parent)
          args.push("--parent", options2.parent);
        if (options2.limit)
          args.push("--limit", String(options2.limit));
        for (const label of Array.isArray(options2.label) ? options2.label : options2.label ? [options2.label] : [])
          args.push("--label", label);
        if (options2.json)
          args.push("--json", options2.json);
        if (options2.jq)
          args.push("--jq", options2.jq);
        return parseJsonOrText((await backend.command(args)).stdout);
      },
      async view(identifier, options2 = {}) {
        const args = ["issue", "view", identifier];
        if (options2.comments)
          args.push("--comments");
        if (options2.json !== undefined)
          args.push("--json", options2.json);
        else
          args.push("--json");
        if (options2.jq)
          args.push("--jq", options2.jq);
        return parseJsonOrText((await backend.command(args)).stdout);
      },
      async create(input) {
        const output = (await backend.command(issueCreateArgs(input))).stdout.trim();
        return this.view(identifierFromCreateOutput2(output));
      },
      async edit(identifier, input) {
        await backend.command(issueEditArgs(identifier, input));
        return this.view(identifier);
      },
      async comment(identifier, body) {
        await backend.command(["issue", "comment", identifier, "--body", body]);
      },
      async close(identifier, options2 = {}) {
        const args = ["issue", "close", identifier];
        if (options2.reason)
          args.push("--reason", options2.reason);
        if (options2.comment)
          args.push("--comment", options2.comment);
        await backend.command(args);
      }
    },
    project: {
      async list(options2 = {}) {
        const args = ["project", "list"];
        if (options2.status)
          args.push("--status", options2.status);
        if (options2.json)
          args.push("--json", options2.json);
        if (options2.jq)
          args.push("--jq", options2.jq);
        return parseJsonOrText((await backend.command(args)).stdout);
      },
      async view(identifier, options2 = {}) {
        const args = ["project", "view", identifier];
        if (options2.json !== undefined)
          args.push("--json", options2.json);
        if (options2.jq)
          args.push("--jq", options2.jq);
        return parseJsonOrText((await backend.command(args)).stdout);
      }
    },
    async snapshot(name = "project-manager", options2 = {}) {
      const args = ["snapshot", name];
      if (options2.format)
        args.push("--format", options2.format);
      return parseJsonOrText((await backend.command(args)).stdout);
    }
  };
}

// src/tx.ts
function baseHash(issue) {
  return createHash2("sha256").update(`${issue.body}\x00${issue.state}`).digest("hex").slice(0, 16);
}
function editDetail(edit) {
  if (edit.op === "set-state")
    return `state -> ${edit.state}`;
  if (edit.op === "set-body")
    return `body replaced (${edit.body.length} chars)`;
  if (edit.op === "check")
    return `ac ${edit.acId} -> checked${edit.commit ? ` (commit ${edit.commit})` : ""}${edit.evidence?.length ? ` [${edit.evidence.join(",")}]` : ""}`;
  if (edit.op === "uncheck")
    return `ac ${edit.acId} -> unchecked`;
  return `ac ${edit.acId} -> status ${edit.status}`;
}
async function readIssue(client, issue) {
  const view = await client.issue.view(issue, { json: "body,state" });
  return { body: String(view.body ?? ""), state: String(view.state ?? "") };
}
async function planTx(edits) {
  const client = createTrackerClient();
  const base = {};
  for (const edit of edits) {
    if (!(edit.issue in base))
      base[edit.issue] = baseHash(await readIssue(client, edit.issue));
  }
  return { edits: edits.map((edit) => ({ issue: edit.issue, op: edit.op, detail: editDetail(edit) })), base };
}
async function applyTx(edits, options) {
  const client = createTrackerClient();
  const plan = await planTx(edits);
  if (options.base) {
    for (const [issue, hash] of Object.entries(options.base)) {
      if (plan.base[issue] !== hash) {
        throw new Error(`tx conflict: ${issue} changed since the transaction was planned (stale base)`);
      }
    }
  }
  const before = checkTrackerSnapshot2(exportTrackerSnapshot({ projectRoot: options.projectRoot }), { projectRoot: options.projectRoot });
  const beforeKeys = new Map;
  for (const finding of before.findings) {
    if (finding.level !== "error")
      continue;
    const key = `${finding.code}|${finding.issue ?? ""}`;
    beforeKeys.set(key, (beforeKeys.get(key) ?? 0) + 1);
  }
  const pre = new Map;
  for (const edit of edits) {
    if (!pre.has(edit.issue))
      pre.set(edit.issue, await readIssue(client, edit.issue));
  }
  const touched = new Set;
  for (const edit of edits) {
    const current = await readIssue(client, edit.issue);
    if (edit.op === "set-state") {
      await client.issue.edit(edit.issue, { state: edit.state });
    } else if (edit.op === "set-body") {
      await client.issue.edit(edit.issue, { body: edit.body });
    } else {
      const result = applyAcMutation(current.body, edit);
      await client.issue.edit(edit.issue, { body: result.body });
    }
    touched.add(edit.issue);
  }
  const after = checkTrackerSnapshot2(exportTrackerSnapshot({ projectRoot: options.projectRoot }), { projectRoot: options.projectRoot });
  const newFindings = [];
  const afterKeys = new Map;
  for (const finding of after.findings) {
    if (finding.level !== "error")
      continue;
    const key = `${finding.code}|${finding.issue ?? ""}`;
    afterKeys.set(key, (afterKeys.get(key) ?? 0) + 1);
    if ((afterKeys.get(key) ?? 0) > (beforeKeys.get(key) ?? 0)) {
      newFindings.push({ code: finding.code, ...finding.issue ? { issue: finding.issue } : {}, message: finding.message });
    }
  }
  const errorsBefore = before.findings.filter((finding) => finding.level === "error").length;
  const errorsAfter = after.findings.filter((finding) => finding.level === "error").length;
  if (newFindings.length > 0) {
    for (const issue of [...touched].reverse()) {
      const snapshot = pre.get(issue);
      await client.issue.edit(issue, { body: snapshot.body, state: snapshot.state });
    }
    return { committed: false, plan, errorsBefore, errorsAfter, newFindings, reverted: true };
  }
  return { committed: true, plan, errorsBefore, errorsAfter, newFindings: [], reverted: false };
}

// src/mutate.ts
var AC_ID_IN_BODY_RE2 = /\b(?<prefix>AC[- ]?|case\/|dev\/|ext\/|proc\/)(?<num>\d{1,3})\b/i;
var STATUS_FIELD_RE2 = /\bstatus:\s*(pending|passed|failed|stale|blocked|descoped)\b/i;
var COMMIT_FIELD_RE3 = /\bcommit[:\s]+[0-9a-f]{7,40}\b\.?/gi;
var AC_VERSION_RE2 = /\s*\bAC-Version:\s*acv_[0-9a-f]{8,64}\b\.?/gi;
var EVIDENCE_REF_RE3 = /\s*\[E\d+\]/g;
var PROOF_REF_RE3 = /\s*\[P\d+\]/g;
function normalizedAcId2(itemBody) {
  const match = AC_ID_IN_BODY_RE2.exec(itemBody);
  if (!match?.groups)
    return null;
  const prefix = match.groups.prefix.toLowerCase().replace(" ", "-");
  const num = Number(match.groups.num);
  return prefix.endsWith("/") ? `${prefix}${String(num).padStart(2, "0")}` : `AC-${String(num).padStart(2, "0")}`;
}
function tidy2(text4) {
  return text4.replace(/[ \t]{2,}/g, " ").replace(/[ \t]+([.,;:])/g, "$1").replace(/[ \t]+$/gm, "").trim();
}
function setStatusField2(itemBody, acId, status) {
  if (STATUS_FIELD_RE2.test(itemBody))
    return itemBody.replace(STATUS_FIELD_RE2, `status: ${status}`);
  const idMatch = AC_ID_IN_BODY_RE2.exec(itemBody);
  if (idMatch && idMatch.index !== undefined) {
    const end = idMatch.index + idMatch[0].length;
    return `${itemBody.slice(0, end)} status: ${status}${itemBody.slice(end)}`;
  }
  return `${acId} status: ${status} ${itemBody}`;
}
function checkItem2(itemBody, acId, mutation) {
  let body = setStatusField2(itemBody, acId, "passed");
  if (mutation.commit) {
    if (/\bcommit[:\s]+[0-9a-f]{7,40}\b/i.test(body)) {
      body = body.replace(/\b(commit[:\s]+)[0-9a-f]{7,40}\b/i, (_full, label) => `${label}${mutation.commit}`);
    } else {
      const tidied = tidy2(body);
      body = `${tidied}${/[.!?\]]$/.test(tidied) ? "" : "."} Commit: ${mutation.commit}.`;
    }
  }
  for (const ref of mutation.evidence ?? []) {
    if (!body.includes(`[${ref}]`))
      body = `${body} [${ref}]`;
  }
  for (const ref of mutation.proof ?? []) {
    if (!body.includes(`[${ref}]`))
      body = `${body} [${ref}]`;
  }
  body = tidy2(body);
  if (mutation.anchor !== false) {
    const stripped = tidy2(body.replace(AC_VERSION_RE2, " "));
    body = `${stripped} AC-Version: ${acVersionForItemBody(acId, stripped)}`;
  }
  return tidy2(body);
}
function uncheckItem2(itemBody, acId) {
  let body = itemBody.replace(COMMIT_FIELD_RE3, " ");
  body = body.replace(AC_VERSION_RE2, " ");
  body = body.replace(EVIDENCE_REF_RE3, "");
  body = body.replace(PROOF_REF_RE3, "");
  body = setStatusField2(tidy2(body), acId, "pending");
  return tidy2(body);
}
function applyAcMutation2(rawBody, mutation) {
  const canonical = canonicalizeIssueMarkdown(rawBody);
  const document4 = parseMarkdownDocument(canonical);
  const targetId = (normalizedAcId2(mutation.acId) ?? mutation.acId).toLowerCase();
  const seenLines = new Set;
  const matches = [];
  for (const section of document4.sections) {
    for (const item2 of section.checkboxItems) {
      if (normalizedAcId2(item2.body)?.toLowerCase() !== targetId)
        continue;
      if (seenLines.has(item2.lineStart))
        continue;
      seenLines.add(item2.lineStart);
      matches.push({ item: item2 });
    }
  }
  if (matches.length === 0)
    throw new Error(`AC ${mutation.acId} not found in issue body`);
  if (matches.length > 1)
    throw new Error(`AC ${mutation.acId} is ambiguous: ${matches.length} checkbox rows carry this id`);
  const item = matches[0].item;
  const canonicalId = normalizedAcId2(item.body) ?? mutation.acId;
  const lines = canonical.split(`
`);
  const bodyLines = item.body.split(`
`);
  const firstLine = bodyLines[0] ?? "";
  const restLines = bodyLines.slice(1);
  let newChecked = item.checked;
  let newFirst = firstLine;
  if (mutation.op === "check") {
    newChecked = true;
    newFirst = checkItem2(firstLine, canonicalId, mutation);
  } else if (mutation.op === "uncheck") {
    newChecked = false;
    newFirst = uncheckItem2(firstLine, canonicalId);
  } else {
    newChecked = mutation.status === "passed" ? true : mutation.status === "pending" ? false : item.checked;
    newFirst = tidy2(setStatusField2(firstLine, canonicalId, mutation.status));
  }
  const newBody = [newFirst, ...restLines].join(`
`);
  const indentMatch = /^(\s*)-/.exec(lines[item.lineStart - 1] ?? "");
  const indent2 = indentMatch?.[1] ?? "";
  const rendered = [`${indent2}- [${newChecked ? "x" : " "}] ${newFirst}`, ...restLines];
  lines.splice(item.lineStart - 1, bodyLines.length, ...rendered);
  const body = canonicalizeIssueMarkdown(lines.join(`
`));
  return {
    body,
    changed: body !== canonical,
    acId: mutation.acId,
    itemBefore: item.body,
    itemAfter: newBody
  };
}

// src/cli.ts
init_config();

// src/export.ts
function activePreset2(options) {
  const projectRoot = options.projectRoot ?? projectRootFrom();
  const config = loadTrackerConfig(projectRoot);
  return resolveTrackerValidation(config, projectRoot);
}
function exportTrackerSnapshot2(options = {}) {
  const exportSnapshot = activePreset2(options).snapshot?.exportSnapshot;
  if (!exportSnapshot)
    throw new Error("Active tracker preset does not implement snapshot.exportSnapshot");
  return exportSnapshot(options);
}

// src/mcp.ts
var TOOLS = [
  {
    name: "tracker_init",
    description: "Initialize ztrack in the current project (writes .volter/tracker-config.json with the selected validation preset, day-one check defaults, and a managed .gitignore). Call this first in a fresh repo — the server starts without a config so an MCP-only agent can bootstrap. Idempotent.",
    inputSchema: { type: "object", properties: {
      team: { type: "string", description: "team key, e.g. APP (default LOCAL)" },
      preset: { type: "string", enum: [...initTrackerPresets()], description: "starter preset to install as editable repo-local validation" }
    } }
  },
  {
    name: "tracker_check",
    description: "Export the tracker snapshot and run the full verification rulebook (state gates, evidence/SHA anchoring). Returns the report; valid=false means findings must be resolved with evidence.",
    inputSchema: { type: "object", properties: {
      issues: { type: "string", description: "Comma-separated case identifiers to restrict to" },
      categories: { type: "object", description: "Advanced preset-specific category override, if the installed validation supports it" }
    } }
  },
  {
    name: "tracker_issue_list",
    description: "List tracker issues (state filter optional).",
    inputSchema: { type: "object", properties: {
      state: { type: "string" },
      limit: { type: "number" }
    } }
  },
  {
    name: "tracker_issue_view",
    description: "View one issue including its body.",
    inputSchema: { type: "object", properties: { issue: { type: "string" } }, required: ["issue"] }
  },
  {
    name: "tracker_issue_create",
    description: "Create an issue.",
    inputSchema: { type: "object", properties: {
      title: { type: "string" },
      body: { type: "string" },
      state: { type: "string" },
      assignee: { type: "string" },
      labels: { type: "array", items: { type: "string" } }
    }, required: ["title"] }
  },
  {
    name: "tracker_ac_check",
    description: 'Check an acceptance criterion: scoped body mutation that sets status passed, records the commit, references evidence by id, and stamps AC-Version. `evidence`/`proof` are ID refs like ["E1"] (create the entries first with tracker_evidence_add) — NOT entry text. The claim is verified by tracker_check, not by this call.',
    inputSchema: { type: "object", properties: {
      issue: { type: "string" },
      acId: { type: "string" },
      commit: { type: "string" },
      evidence: { type: "array", items: { type: "string" }, description: 'evidence id refs, e.g. ["E1"]' },
      proof: { type: "array", items: { type: "string" } }
    }, required: ["issue", "acId"] }
  },
  {
    name: "tracker_evidence_add",
    description: "Add an evidence entry ([En]) to the issue Evidence section and return its id. Use this BEFORE tracker_ac_check, then pass the returned id in ac_check evidence. Installed presets verify that the row exists; project presets may add stricter PR/screenshot/video checks.",
    inputSchema: { type: "object", properties: {
      issue: { type: "string" },
      type: { type: "string", enum: ["pr", "screenshot", "video", "other"] },
      ac: { type: "string" },
      repo: { type: "string" },
      number: { type: "string" },
      head: { type: "string" },
      state: { type: "string" },
      path: { type: "string" },
      url: { type: "string" },
      status: { type: "string" },
      justification: { type: "string" }
    }, required: ["issue", "type"] }
  },
  {
    name: "tracker_ac_uncheck",
    description: "Uncheck an acceptance criterion (strips commit/evidence claims, resets to pending).",
    inputSchema: { type: "object", properties: { issue: { type: "string" }, acId: { type: "string" } }, required: ["issue", "acId"] }
  },
  {
    name: "tracker_ac_set_status",
    description: "Set an acceptance criterion status (pending|passed|failed|stale|blocked|descoped).",
    inputSchema: { type: "object", properties: { issue: { type: "string" }, acId: { type: "string" }, status: { type: "string" } }, required: ["issue", "acId", "status"] }
  },
  {
    name: "tracker_fmt",
    description: "Canonicalize an issue body (whitespace, checkbox markers, section order). write=false previews.",
    inputSchema: { type: "object", properties: { issue: { type: "string" }, write: { type: "boolean" } }, required: ["issue"] }
  }
];
async function callTool(name, args) {
  if (name === "tracker_init") {
    const preset = initTrackerPresets().includes(args.preset) ? args.preset : "basic";
    const result = initTrackerProject(process.cwd(), args.team ? String(args.team) : "LOCAL", { preset });
    return {
      configPath: result.configPath,
      alreadyInitialized: result.alreadyInitialized,
      teamKey: result.teamKey,
      preset: result.preset,
      ...result.validationEntrypoint ? { validationEntrypoint: result.validationEntrypoint } : {}
    };
  }
  const projectRoot = projectRootFrom();
  const client = createTrackerClient();
  switch (name) {
    case "tracker_check": {
      const issues = args.issues ? String(args.issues).split(",").map((s) => s.trim()).filter(Boolean) : undefined;
      const snapshot = exportTrackerSnapshot({ projectRoot, ...issues ? { issues } : {} });
      return checkTrackerSnapshot2(snapshot, {
        projectRoot,
        ...issues ? { issues } : {},
        ...args.categories ? { categories: args.categories } : {}
      });
    }
    case "tracker_issue_list":
      return client.issue.list({ ...args.state ? { state: args.state } : {}, limit: args.limit ?? 20, json: "identifier,title,state" });
    case "tracker_issue_view":
      return client.issue.view(String(args.issue), { json: "identifier,title,state,labels,body" });
    case "tracker_issue_create":
      return client.issue.create({
        title: String(args.title),
        ...args.body ? { body: args.body } : {},
        ...args.state ? { state: args.state } : {},
        ...args.assignee ? { assignee: String(args.assignee) } : {},
        ...args.labels ? { labels: args.labels } : {}
      });
    case "tracker_ac_check":
    case "tracker_ac_uncheck":
    case "tracker_ac_set_status": {
      const issue = await client.issue.view(String(args.issue), { json: "body" });
      const body = String(issue.body ?? "");
      const toRefs = (v) => {
        if (v === undefined || v === null)
          return;
        const arr = Array.isArray(v) ? v.map(String) : String(v).split(/[,\s]+/);
        return arr.map((s) => s.trim()).filter(Boolean);
      };
      const evidence = toRefs(args.evidence);
      const proof = toRefs(args.proof);
      const result = name === "tracker_ac_check" ? applyAcMutation(body, { op: "check", acId: String(args.acId), ...args.commit ? { commit: String(args.commit) } : {}, ...evidence?.length ? { evidence } : {}, ...proof?.length ? { proof } : {} }) : name === "tracker_ac_uncheck" ? applyAcMutation(body, { op: "uncheck", acId: String(args.acId) }) : applyAcMutation(body, { op: "set-status", acId: String(args.acId), status: String(args.status) });
      await client.issue.edit(String(args.issue), { body: result.body });
      return { issue: args.issue, acId: result.acId, changed: result.changed, itemAfter: result.itemAfter };
    }
    case "tracker_evidence_add": {
      const issue = await client.issue.view(String(args.issue), { json: "body" });
      const body = String(issue.body ?? "");
      const spec = { type: String(args.type) };
      for (const key of ["ac", "repo", "number", "head", "state", "path", "url", "status", "justification"]) {
        if (args[key] !== undefined)
          spec[key] = String(args[key]);
      }
      const result = addEvidenceEntry(body, spec);
      await client.issue.edit(String(args.issue), { body: result.body });
      return { issue: args.issue, evidenceId: result.evidenceId };
    }
    case "tracker_fmt": {
      const issue = await client.issue.view(String(args.issue), { json: "body" });
      const body = String(issue.body ?? "");
      const formatted = canonicalizeIssueMarkdown(body);
      if (args.write && formatted !== body)
        await client.issue.edit(String(args.issue), { body: formatted });
      return { issue: args.issue, canonical: formatted === body, ...args.write ? { written: formatted !== body } : { preview: formatted } };
    }
    default:
      throw new Error(`unknown tool: ${name}`);
  }
}
async function serveMcp() {
  const write = (message) => process.stdout.write(`${JSON.stringify(message)}
`);
  let buffer = "";
  for await (const chunk of process.stdin) {
    buffer += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
    let index2;
    while ((index2 = buffer.indexOf(`
`)) >= 0) {
      const line = buffer.slice(0, index2).trim();
      buffer = buffer.slice(index2 + 1);
      if (!line)
        continue;
      let request;
      try {
        request = JSON.parse(line);
      } catch {
        continue;
      }
      if (request.id === undefined || request.id === null)
        continue;
      try {
        if (request.method === "initialize") {
          write({ jsonrpc: "2.0", id: request.id, result: {
            protocolVersion: request.params?.protocolVersion ?? "2024-11-05",
            capabilities: { tools: {} },
            serverInfo: { name: "ztrack", version: "0.4.0" }
          } });
        } else if (request.method === "tools/list") {
          write({ jsonrpc: "2.0", id: request.id, result: { tools: TOOLS } });
        } else if (request.method === "tools/call") {
          const result = await callTool(String(request.params?.name), request.params?.arguments ?? {});
          write({ jsonrpc: "2.0", id: request.id, result: { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] } });
        } else if (request.method === "ping") {
          write({ jsonrpc: "2.0", id: request.id, result: {} });
        } else {
          write({ jsonrpc: "2.0", id: request.id, error: { code: -32601, message: `method not found: ${request.method}` } });
        }
      } catch (error) {
        write({ jsonrpc: "2.0", id: request.id, error: { code: -32000, message: error instanceof Error ? error.message : String(error) } });
      }
    }
  }
}

// src/server.ts
import { createServer } from "node:http";
async function serveTrackerApi(options = {}) {
  const client = createTrackerClient({ projectRoot: options.projectRoot });
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 8765;
  const server = createServer(async (request, response) => {
    if (request.method !== "POST" || request.url !== "/graphql") {
      response.writeHead(404);
      response.end();
      return;
    }
    try {
      const chunks = [];
      for await (const chunk of request)
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      const payload = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
      const result = await client.graphql(payload.query ?? "", payload.variables);
      const body = JSON.stringify(result, null, 2);
      response.writeHead(result.errors?.length ? 500 : 200, {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(body)
      });
      response.end(body);
    } catch (error) {
      const body = JSON.stringify({ errors: [{ message: error instanceof Error ? error.message : String(error) }] }, null, 2);
      response.writeHead(500, { "content-type": "application/json", "content-length": Buffer.byteLength(body) });
      response.end(body);
    }
  });
  await new Promise((resolve4) => server.listen(port, host, resolve4));
  const address = server.address();
  const actualPort = typeof address === "object" && address ? address.port : port;
  console.error(`tracker api listening on http://${host}:${actualPort}/graphql`);
}

// src/sdk.ts
function parseJsonOrText2(stdout) {
  const text4 = stdout.trim();
  if (!text4)
    return null;
  try {
    return JSON.parse(text4);
  } catch {
    return text4;
  }
}
function identifierFromCreateOutput3(stdout) {
  const trimmed = stdout.trim();
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === "object" && typeof parsed.identifier === "string") {
      return parsed.identifier;
    }
  } catch {}
  return trimmed.split(/\s+/)[0] ?? "";
}
function issueCreateArgs2(input) {
  const args = ["issue", "create", "--title", input.title];
  if (input.body)
    args.push("--body", input.body);
  if (input.state)
    args.push("--state", input.state);
  if (input.assignee)
    args.push("--assignee", input.assignee);
  if (input.parent)
    args.push("--parent", input.parent);
  if (input.project)
    args.push("--project", input.project);
  for (const label of input.labels ?? [])
    args.push("--label", label);
  return args;
}
function issueEditArgs2(identifier, input) {
  const args = ["issue", "edit", identifier];
  if (input.title)
    args.push("--title", input.title);
  if (input.body !== undefined)
    args.push("--body", input.body);
  if (input.state)
    args.push("--state", input.state);
  if (input.project)
    args.push("--project", input.project);
  if (input.removeProject)
    args.push("--remove-project");
  if (input.parent)
    args.push("--parent", input.parent);
  if (input.removeParent)
    args.push("--remove-parent");
  for (const label of input.addLabels ?? [])
    args.push("--add-label", label);
  for (const label of input.removeLabels ?? [])
    args.push("--remove-label", label);
  return args;
}
function createTrackerClient2(options = {}) {
  const projectRoot = options.projectRoot ?? projectRootFrom();
  loadEnvFiles(projectRoot);
  const config = loadTrackerConfig(projectRoot);
  const backend = config.backend === "markdown" ? createMarkdownBackend(projectRoot, config.local?.teamKey ?? "PH") : createLocalBackend(config.backend, projectRoot);
  return {
    command(args, inputText) {
      return backend.command(args, inputText);
    },
    async graphql(query, variables) {
      return executeTrackerGraphql(backend, query, variables);
    },
    issue: {
      async list(options2 = {}) {
        const args = ["issue", "list"];
        if (options2.state)
          args.push("--state", options2.state);
        if (options2.search)
          args.push("--search", options2.search);
        if (options2.parent)
          args.push("--parent", options2.parent);
        if (options2.limit)
          args.push("--limit", String(options2.limit));
        for (const label of Array.isArray(options2.label) ? options2.label : options2.label ? [options2.label] : [])
          args.push("--label", label);
        if (options2.json)
          args.push("--json", options2.json);
        if (options2.jq)
          args.push("--jq", options2.jq);
        return parseJsonOrText2((await backend.command(args)).stdout);
      },
      async view(identifier, options2 = {}) {
        const args = ["issue", "view", identifier];
        if (options2.comments)
          args.push("--comments");
        if (options2.json !== undefined)
          args.push("--json", options2.json);
        else
          args.push("--json");
        if (options2.jq)
          args.push("--jq", options2.jq);
        return parseJsonOrText2((await backend.command(args)).stdout);
      },
      async create(input) {
        const output = (await backend.command(issueCreateArgs2(input))).stdout.trim();
        return this.view(identifierFromCreateOutput3(output));
      },
      async edit(identifier, input) {
        await backend.command(issueEditArgs2(identifier, input));
        return this.view(identifier);
      },
      async comment(identifier, body) {
        await backend.command(["issue", "comment", identifier, "--body", body]);
      },
      async close(identifier, options2 = {}) {
        const args = ["issue", "close", identifier];
        if (options2.reason)
          args.push("--reason", options2.reason);
        if (options2.comment)
          args.push("--comment", options2.comment);
        await backend.command(args);
      }
    },
    project: {
      async list(options2 = {}) {
        const args = ["project", "list"];
        if (options2.status)
          args.push("--status", options2.status);
        if (options2.json)
          args.push("--json", options2.json);
        if (options2.jq)
          args.push("--jq", options2.jq);
        return parseJsonOrText2((await backend.command(args)).stdout);
      },
      async view(identifier, options2 = {}) {
        const args = ["project", "view", identifier];
        if (options2.json !== undefined)
          args.push("--json", options2.json);
        if (options2.jq)
          args.push("--jq", options2.jq);
        return parseJsonOrText2((await backend.command(args)).stdout);
      }
    },
    async snapshot(name = "project-manager", options2 = {}) {
      const args = ["snapshot", name];
      if (options2.format)
        args.push("--format", options2.format);
      return parseJsonOrText2((await backend.command(args)).stdout);
    }
  };
}

// src/cliArgs.ts
function optionValue(args, name, fallback = "") {
  const inline = args.find((a) => a.startsWith(`${name}=`));
  if (inline !== undefined)
    return inline.slice(name.length + 1);
  const index2 = args.indexOf(name);
  if (index2 < 0 || index2 + 1 >= args.length)
    return fallback;
  const next = args[index2 + 1];
  return next.startsWith("--") ? fallback : next;
}

// src/cliEvidence.ts
import { readFileSync as readFileSync5, mkdirSync as mkdirSync4, writeFileSync as writeFileSync4 } from "node:fs";
import { isAbsolute as isAbsolute3, resolve as resolve4 } from "node:path";

// src/attest.ts
var STATEMENT_TYPE = "https://in-toto.io/Statement/v1";
function commitDigest(sha) {
  return /^[0-9a-f]{40}$/i.test(sha) ? { gitCommit: sha.toLowerCase() } : { gitCommitAbbrev: sha.toLowerCase() };
}
function claimsFor(ac, acVersions, fallbackVersion) {
  return ac.map((acId) => ({ acId, acVersion: acVersions[acId] || fallbackVersion || "" }));
}
function field(entry, name) {
  const direct = entry[name];
  if (typeof direct === "string")
    return direct;
  if (typeof direct === "number" || typeof direct === "boolean")
    return String(direct);
  return entry.fields?.[name] ?? "";
}
function versionMap(raw) {
  const out = {};
  for (const part of raw.split(/[,\s]+/).map((value) => value.trim()).filter(Boolean)) {
    const match = /^(?<id>(?:[a-z]+\/|AC-)\d{1,3})=(?<version>acv_[0-9a-f]{8,64})$/i.exec(part);
    if (match?.groups)
      out[match.groups.id.toLowerCase().replace(/([/-])(\d)$/, (_m, sep, digit) => `${sep}0${digit}`)] = match.groups.version;
  }
  return out;
}
function listField(raw) {
  return raw.split(/[,\s]+/).map((value) => value.trim()).filter(Boolean);
}
function stringListField(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string" && item.length > 0) : [];
}
function asEntries(value) {
  return Array.isArray(value) ? value.filter((item) => Boolean(item) && typeof item === "object" && typeof item.id === "string") : [];
}
function caseEvidence(currentCase) {
  const validated = asEntries(currentCase.validatedIssue?.evidence);
  return validated.length ? validated : asEntries(currentCase.evidence);
}
function caseProofs(currentCase) {
  const validated = asEntries(currentCase.validatedIssue?.proofs);
  return validated.length ? validated : asEntries(currentCase.proofs);
}
function caseAcceptanceCriteria(currentCase) {
  const validated = currentCase.validatedIssue?.acceptanceCriteria;
  if (Array.isArray(validated) && validated.length)
    return validated;
  const exported = currentCase.acceptanceCriteria;
  return Array.isArray(exported) ? exported : [];
}
function caseImplementationSha(currentCase) {
  const exportedSha = currentCase.currentImplementationSha;
  if (typeof exportedSha === "string" && exportedSha)
    return exportedSha;
  const evidence = caseEvidence(currentCase);
  const pr = evidence.find((entry) => entry.type === "pr" && field(entry, "head"));
  if (pr)
    return field(pr, "head");
  const merged = evidence.find((entry) => entry.type === "pr" && field(entry, "merge-commit"));
  if (merged)
    return field(merged, "merge-commit");
  const commits = [...new Set(caseAcceptanceCriteria(currentCase).flatMap((criterion) => stringListField(criterion.commitHashes)))];
  return commits.length === 1 ? commits[0] : "";
}
function exportInTotoStatements(snapshot, options = {}) {
  const issueFilter = options.issues ? new Set(options.issues) : null;
  const statements = [];
  const skipped = [];
  for (const currentCase of snapshot.cases) {
    if (issueFilter && !issueFilter.has(currentCase.identifier))
      continue;
    const subjectName = currentCase.identifier;
    const caseSha = caseImplementationSha(currentCase);
    for (const entry of caseEvidence(currentCase)) {
      const approvedSha = field(entry, "approved-sha");
      const approvedEvidence = listField(field(entry, "approved-evidence"));
      const isApproval = Boolean(approvedSha || approvedEvidence.length > 0);
      const own3 = field(entry, "sha") || field(entry, "head") || (isApproval ? approvedSha : "");
      const sha = own3 || caseSha;
      if (!sha) {
        skipped.push({ issue: subjectName, entry: entry.id, reason: "no commit anchor (entry or case)" });
        continue;
      }
      const base = {
        issue: subjectName,
        entryId: entry.id,
        claims: claimsFor(entry.ac ?? [], versionMap(field(entry, "ac-version")), field(entry, "ac-version")),
        anchorSource: own3 ? isApproval && !field(entry, "sha") && !field(entry, "head") ? "approval" : "entry" : "case-implementation",
        ...field(entry, "justification") ? { justification: field(entry, "justification") } : {},
        environment: { world: "production" }
      };
      if (isApproval) {
        statements.push({
          _type: STATEMENT_TYPE,
          subject: [{ name: subjectName, digest: commitDigest(approvedSha || sha) }],
          predicateType: "https://volter.ai/attestation/approval/v1",
          predicate: {
            ...base,
            approvedClaims: Object.entries(versionMap(field(entry, "approved-ac-version"))).map(([acId, acVersion]) => ({ acId, acVersion })),
            approvedEvidence
          }
        });
        continue;
      }
      if (entry.type === "screenshot") {
        statements.push({
          _type: STATEMENT_TYPE,
          subject: [{ name: subjectName, digest: commitDigest(sha) }],
          predicateType: "https://volter.ai/attestation/screenshot-evidence/v1",
          predicate: { ...base, media: { ...field(entry, "path") ? { path: field(entry, "path") } : {}, ...field(entry, "url") ? { url: field(entry, "url") } : {} } }
        });
      } else if (entry.type === "video") {
        statements.push({
          _type: STATEMENT_TYPE,
          subject: [{ name: subjectName, digest: commitDigest(sha) }],
          predicateType: "https://volter.ai/attestation/human-qa/v1",
          predicate: { ...base, result: field(entry, "result") || field(entry, "status") || "", ...field(entry, "url") ? { session: { url: field(entry, "url") } } : {}, ...field(entry, "summary") ? { summary: field(entry, "summary") } : {} }
        });
      } else if (entry.type === "pr") {
        statements.push({
          _type: STATEMENT_TYPE,
          subject: [{ name: subjectName, digest: commitDigest(sha) }],
          predicateType: "https://volter.ai/attestation/change-review/v1",
          predicate: {
            ...base,
            review: {
              repo: field(entry, "repo"),
              number: Number(field(entry, "number")) || 0,
              state: field(entry, "state"),
              draft: ["true", "yes", "1"].includes(field(entry, "draft").toLowerCase()),
              ...field(entry, "merge-commit") ? { mergeCommit: field(entry, "merge-commit") } : {}
            }
          }
        });
      } else {
        statements.push({
          _type: STATEMENT_TYPE,
          subject: [{ name: subjectName, digest: commitDigest(sha) }],
          predicateType: "https://volter.ai/attestation/evidence/v1",
          predicate: base
        });
      }
    }
    for (const proof of caseProofs(currentCase)) {
      const proofSha = field(proof, "sha") || caseSha;
      if (!proofSha) {
        skipped.push({ issue: subjectName, entry: proof.id, reason: "no commit anchor (proof or case)" });
        continue;
      }
      statements.push({
        _type: STATEMENT_TYPE,
        subject: [{ name: subjectName, digest: commitDigest(proofSha) }],
        predicateType: "https://volter.ai/attestation/proof/v1",
        predicate: {
          issue: subjectName,
          entryId: proof.id,
          anchorSource: field(proof, "sha") ? "entry" : "case-implementation",
          claim: field(proof, "claim"),
          claims: claimsFor(proof.ac ?? [], versionMap(field(proof, "ac-version")), field(proof, "ac-version")),
          evidence: proof.evidence ?? [],
          environment: { world: "production" }
        }
      });
    }
  }
  return { statements, skipped };
}

// src/blobStore.ts
import { createHash as createHash3 } from "node:crypto";
import { existsSync as existsSync5, readFileSync as readFileSync4 } from "node:fs";
import { isAbsolute as isAbsolute2, join as join4 } from "node:path";
function readJson(path2) {
  try {
    return JSON.parse(readFileSync4(path2, "utf8"));
  } catch {
    return null;
  }
}
function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function trackerDbPath(projectRoot) {
  const config = readJson(trackerConfigPath(projectRoot));
  if (!isObject(config) || config.backend !== "local")
    return null;
  const local = isObject(config.local) ? config.local : {};
  const rel = typeof local.database === "string" && local.database ? local.database : join4(stateDirName(), "tracker.sqlite");
  const dbPath = isAbsolute2(rel) ? rel : join4(projectRoot, rel);
  return existsSync5(dbPath) ? dbPath : null;
}
function openDb(projectRoot) {
  const dbPath = trackerDbPath(projectRoot);
  if (!dbPath)
    return null;
  const { Database } = __require("bun:sqlite");
  const db = new Database(dbPath);
  db.exec(`CREATE TABLE IF NOT EXISTS tracker_blob (
       hash TEXT PRIMARY KEY,
       bytes BLOB NOT NULL,
       media_type TEXT,
       size INTEGER NOT NULL,
       created_at TEXT NOT NULL
     )`);
  return db;
}
function sha256(bytes) {
  return createHash3("sha256").update(bytes).digest("hex");
}
function putBlob(projectRoot, bytes, mediaType) {
  const hash = sha256(bytes);
  const db = openDb(projectRoot);
  if (!db)
    throw new Error("tracker blob store: no local sqlite DB resolved (is backend `local` configured?)");
  try {
    db.run("INSERT OR IGNORE INTO tracker_blob(hash, bytes, media_type, size, created_at) VALUES(?, ?, ?, ?, ?)", hash, bytes, mediaType ?? null, bytes.byteLength, new Date().toISOString());
  } finally {
    db.close();
  }
  return `sha256:${hash}`;
}

// src/cliArgs.ts
function optionValue2(args, name, fallback = "") {
  const inline = args.find((a) => a.startsWith(`${name}=`));
  if (inline !== undefined)
    return inline.slice(name.length + 1);
  const index2 = args.indexOf(name);
  if (index2 < 0 || index2 + 1 >= args.length)
    return fallback;
  const next = args[index2 + 1];
  return next.startsWith("--") ? fallback : next;
}

// src/dsse.ts
import { createHash as createHash4, generateKeyPairSync, sign, verify, createPublicKey, createPrivateKey } from "node:crypto";
var PAYLOAD_TYPE = "application/vnd.in-toto+json";
function preAuthEncoding(payloadType, payload) {
  return Buffer.concat([
    Buffer.from(`DSSEv1 ${Buffer.byteLength(payloadType)} ${payloadType} ${payload.byteLength} `),
    payload
  ]);
}
function generateSigningKey() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  return {
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    publicKeyPem,
    keyid: keyidFor(publicKeyPem)
  };
}
function keyidFor(publicKeyPem) {
  return createHash4("sha256").update(publicKeyPem.trim()).digest("hex").slice(0, 16);
}
function signStatement(statement, privateKeyPem, publicKeyPem) {
  const payload = Buffer.from(JSON.stringify(statement));
  const signature = sign(null, preAuthEncoding(PAYLOAD_TYPE, payload), createPrivateKey(privateKeyPem));
  return {
    payload: payload.toString("base64"),
    payloadType: PAYLOAD_TYPE,
    signatures: [{ keyid: keyidFor(publicKeyPem), sig: signature.toString("base64") }]
  };
}
function verifyEnvelope(envelope, publicKeyPem) {
  if (envelope.payloadType !== PAYLOAD_TYPE)
    return { ok: false, reason: "payload-type" };
  const signature = envelope.signatures?.[0];
  if (!signature)
    return { ok: false, reason: "no-signature" };
  const expectedKeyid = keyidFor(publicKeyPem);
  if (signature.keyid && signature.keyid !== expectedKeyid)
    return { ok: false, reason: "keyid-mismatch" };
  const payload = Buffer.from(envelope.payload, "base64");
  const valid = verify(null, preAuthEncoding(PAYLOAD_TYPE, payload), createPublicKey(publicKeyPem), Buffer.from(signature.sig, "base64"));
  if (!valid)
    return { ok: false, reason: "bad-signature" };
  try {
    return { ok: true, statement: JSON.parse(payload.toString()), keyid: expectedKeyid };
  } catch {
    return { ok: false, reason: "malformed" };
  }
}

// src/cliEvidence.ts
async function handleEvidenceCommand(args, client) {
  if (args[0] !== "evidence")
    return false;
  if (args[1] === "add") {
    const issueId = args[2];
    const type = optionValue2(args, "--type");
    if (!issueId || !/^[a-z][a-z0-9-]*$/i.test(type))
      throw new Error("usage: tracker evidence add <issue> --type <kind>");
    const issue = await client.issue.view(issueId, { json: "body" });
    const body = String(issue.body ?? "");
    const filePath = optionValue2(args, "--file");
    let blobRef = "";
    if (filePath && !args.includes("--dry-run")) {
      const abs = isAbsolute3(filePath) ? filePath : resolve4(projectRootFrom(), filePath);
      const bytes = readFileSync5(abs);
      const ext = abs.toLowerCase().split(".").pop() ?? "";
      const mediaType = ext === "png" ? "image/png" : ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "webp" ? "image/webp" : undefined;
      blobRef = putBlob(projectRootFrom(), new Uint8Array(bytes), mediaType);
    }
    const spec = {
      type,
      ...optionValue2(args, "--ac") ? { ac: optionValue2(args, "--ac") } : {},
      ...optionValue2(args, "--repo") ? { repo: optionValue2(args, "--repo") } : {},
      ...optionValue2(args, "--number") ? { number: optionValue2(args, "--number") } : {},
      ...optionValue2(args, "--head") ? { head: optionValue2(args, "--head") } : {},
      ...optionValue2(args, "--state") ? { state: optionValue2(args, "--state") } : {},
      ...optionValue2(args, "--path") ? { path: optionValue2(args, "--path") } : {},
      ...optionValue2(args, "--url") ? { url: optionValue2(args, "--url") } : {},
      ...blobRef ? { blob: blobRef } : {},
      ...optionValue2(args, "--status") ? { status: optionValue2(args, "--status") } : {},
      ...optionValue2(args, "--justification") ? { justification: optionValue2(args, "--justification") } : {}
    };
    const result = addEvidenceEntry(body, spec);
    if (!args.includes("--dry-run"))
      await client.issue.edit(issueId, { body: result.body });
    process.stdout.write(`${JSON.stringify({ issue: issueId, evidenceId: result.evidenceId, dryRun: args.includes("--dry-run") }, null, 2)}
`);
    return true;
  }
  if (args[1] === "keygen") {
    const key = generateSigningKey();
    const dir = optionValue2(args, "--out-dir") || ".volter/keys";
    const base = resolve4(projectRootFrom(), dir);
    mkdirSync4(base, { recursive: true });
    writeFileSync4(resolve4(base, "evidence-signing.pem"), key.privateKeyPem, { mode: 384 });
    writeFileSync4(resolve4(base, "evidence-signing.pub.pem"), key.publicKeyPem);
    process.stdout.write(`${JSON.stringify({ keyid: key.keyid, privateKey: `${dir}/evidence-signing.pem`, publicKey: `${dir}/evidence-signing.pub.pem` }, null, 2)}
`);
    return true;
  }
  if (args[1] === "verify") {
    const bundlePath = optionValue2(args, "--bundle");
    const keyPath = optionValue2(args, "--key");
    if (!bundlePath || !keyPath)
      throw new Error("usage: tracker evidence verify --bundle envelopes.json --key public.pem");
    const publicKeyPem = readFileSync5(resolve4(process.cwd(), keyPath), "utf8");
    const bundle = JSON.parse(readFileSync5(resolve4(process.cwd(), bundlePath), "utf8"));
    if (!Array.isArray(bundle.envelopes))
      throw new Error(`bundle ${bundlePath} is missing an "envelopes" array`);
    const results = bundle.envelopes.map((envelope, index2) => {
      const verdict = verifyEnvelope(envelope, publicKeyPem);
      return verdict.ok ? { index: index2, ok: true, predicateType: verdict.statement.predicateType, subject: verdict.statement.subject[0] } : { index: index2, ok: false, reason: verdict.reason };
    });
    const failed = results.filter((result) => !result.ok).length;
    process.stdout.write(`${JSON.stringify({ verified: results.length - failed, failed, results: failed ? results.filter((r) => !r.ok) : undefined }, null, 2)}
`);
    process.exitCode = failed > 0 ? 1 : 0;
    return true;
  }
  if (args[1] === "ingest") {
    const bundlePath = optionValue2(args, "--bundle");
    const keyPath = optionValue2(args, "--key");
    const issueId = optionValue2(args, "--issue");
    if (!bundlePath || !keyPath || !issueId)
      throw new Error("usage: tracker evidence ingest --bundle envelopes.json --key public.pem --issue A-1 [--ac ac/01]");
    const publicKeyPem = readFileSync5(resolve4(process.cwd(), keyPath), "utf8");
    const bundle = JSON.parse(readFileSync5(resolve4(process.cwd(), bundlePath), "utf8"));
    if (!Array.isArray(bundle.envelopes))
      throw new Error(`bundle ${bundlePath} is missing an "envelopes" array`);
    const acId = optionValue2(args, "--ac");
    const issue = await client.issue.view(issueId, { json: "body" });
    let body = String(issue.body ?? "");
    let nextId = Math.max(0, ...[...body.matchAll(/^\s*\[E(\d+)\]/gm)].map((match) => Number(match[1]))) + 1;
    const ingested = [];
    const rejected = [];
    for (const envelope of bundle.envelopes) {
      const verdict = verifyEnvelope(envelope, publicKeyPem);
      if (!verdict.ok) {
        rejected.push({ reason: verdict.reason });
        continue;
      }
      const statement = verdict.statement;
      const sha = String(statement.subject[0]?.digest?.gitCommit ?? statement.subject[0]?.digest?.gitCommitAbbrev ?? "");
      const predicate = statement.predicate;
      const result = String(predicate.result ?? predicate.outcome ?? "");
      const summary = String(predicate.summary ?? statement.predicateType.split("/").slice(-2, -1)[0] ?? "attested evidence");
      const entryId = `E${nextId++}`;
      const acField = acId || (predicate.claims?.[0]?.acId ?? "");
      const line = `[${entryId}] type: other sha: ${sha}${acField ? ` ac: ${acField}` : ""} justification: ${summary} (signed attestation ${statement.predicateType}, verified keyid ${verdict.keyid}${result ? `, result: ${result}` : ""})`;
      body = /## Evidence/.test(body) ? body.replace(/## Evidence\n/, `## Evidence

${line}
`) : `${body.replace(/\n+$/, "")}

## Evidence

${line}
`;
      ingested.push({ entryId, sha, predicateType: statement.predicateType, keyid: verdict.keyid });
    }
    if (ingested.length > 0)
      await client.issue.edit(issueId, { body: canonicalizeIssueMarkdown(body) });
    process.stdout.write(`${JSON.stringify({ issue: issueId, ingested, rejected }, null, 2)}
`);
    process.exitCode = rejected.length > 0 && ingested.length === 0 ? 1 : 0;
    return true;
  }
  if (args[1] === "export") {
    if (optionValue2(args, "--format") !== "in-toto")
      throw new Error("tracker evidence export: only --format in-toto is supported");
    const projectRoot = projectRootFrom();
    const snapshot = exportTrackerSnapshot({ projectRoot });
    const issuesFilter = optionValue2(args, "--issues");
    const result = exportInTotoStatements(snapshot, issuesFilter ? { issues: issuesFilter.split(",").map((s) => s.trim()).filter(Boolean) } : {});
    const keyPath = optionValue2(args, "--sign-key");
    const text4 = keyPath ? `${JSON.stringify({ envelopes: result.statements.map((statement) => signStatement(statement, readFileSync5(resolve4(process.cwd(), keyPath), "utf8"), readFileSync5(resolve4(process.cwd(), keyPath.replace(/\.pem$/, ".pub.pem")), "utf8"))), skipped: result.skipped }, null, 2)}
` : `${JSON.stringify(result, null, 2)}
`;
    const outPath = optionValue2(args, "--out");
    if (outPath)
      writeFileSync4(isAbsolute3(outPath) ? outPath : resolve4(projectRoot, outPath), text4);
    else
      process.stdout.write(text4);
    return true;
  }
  return false;
}

// src/cliStyle.ts
var wantsColor = (stream) => {
  if (process.env.NO_COLOR)
    return false;
  if (process.env.FORCE_COLOR && process.env.FORCE_COLOR !== "0")
    return true;
  return Boolean(stream.isTTY);
};
var color2 = (open, close = "\x1B[0m") => (text4) => wantsColor(process.stdout) ? `${open}${text4}${close}` : text4;
var ui = {
  dim: color2("\x1B[2m"),
  bold: color2("\x1B[1m"),
  green: color2("\x1B[32m"),
  red: color2("\x1B[31m"),
  yellow: color2("\x1B[33m"),
  blue: color2("\x1B[34m"),
  cyan: color2("\x1B[36m"),
  magenta: color2("\x1B[35m"),
  redBadge: color2("\x1B[41m\x1B[30m\x1B[1m"),
  yellowBadge: color2("\x1B[43m\x1B[30m\x1B[1m")
};
function heading(title, subtitle) {
  return `${ui.bold(title)}${subtitle ? ` ${ui.dim(subtitle)}` : ""}`;
}
function helpSection(position2, title, rows) {
  const width = 66;
  const commandWidth = 31;
  const descriptionWidth = width - commandWidth - 6;
  const headerText = ` ${title} `;
  const header = `${ui.dim(`╭─${headerText}${"─".repeat(width - headerText.length - 2)}╮`)}`;
  const body = rows.map(([command, description]) => `${ui.dim("│")}  ${ui.cyan(command.padEnd(commandWidth))} ${ui.dim(description.padEnd(descriptionWidth))} ${ui.dim("│")}`);
  return [header, ...body, ui.dim(`╰${"─".repeat(width - 2)}╯`)].join(`
`);
}
function statusMark(kind) {
  if (kind === "pass")
    return ui.green("✓");
  if (kind === "fail")
    return ui.red("✗");
  if (kind === "warn")
    return ui.yellow("!");
  return ui.blue("•");
}
function numberValue(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
function statusText(report) {
  if (report.valid)
    return `${statusMark("pass")} ${ui.green("ztrack check passed")}`;
  return `${statusMark("fail")} ${ui.red("ztrack check failed")}`;
}
function metric(label, value) {
  return `${ui.dim(label)} ${ui.bold(String(value ?? 0))}`;
}
function metricBox(summary) {
  const raw = [
    `cases ${summary.cases ?? 0}`,
    `open ${summary.openCases ?? 0}`,
    `errors ${summary.errors ?? 0}`,
    `warnings ${summary.warnings ?? 0}`
  ].join("  •  ");
  const content3 = [
    metric("cases", summary.cases),
    metric("open", summary.openCases),
    numberValue(summary.errors) > 0 ? `${ui.dim("errors")} ${ui.red(String(summary.errors))}` : metric("errors", summary.errors),
    numberValue(summary.warnings) > 0 ? `${ui.dim("warnings")} ${ui.yellow(String(summary.warnings))}` : metric("warnings", summary.warnings)
  ].join(ui.dim("  •  "));
  const width = raw.length + 4;
  return [
    ui.dim(`╭${"─".repeat(width)}╮`),
    `${ui.dim("│")} ${content3} ${ui.dim("│")}`,
    ui.dim(`╰${"─".repeat(width)}╯`)
  ].join(`
`);
}
function findingGroupKey(finding) {
  return finding.issue || "workspace";
}
function findingLevel(finding) {
  return finding.level === "error" ? ui.redBadge(" x error ") : ui.yellowBadge(" warn ");
}
function codeLabel(code2) {
  return ui.dim(code2);
}
function renderCheckReport(report, options = {}) {
  const summary = report.summary;
  const findings = report.findings.filter((finding) => !options.errorsOnly || finding.level === "error").slice().sort((a, b) => {
    if (a.level !== b.level)
      return a.level === "error" ? -1 : 1;
    return findingGroupKey(a).localeCompare(findingGroupKey(b)) || a.code.localeCompare(b.code);
  });
  const maxFindings = options.maxFindings ?? 120;
  const shown = findings.slice(0, maxFindings);
  const lines = [
    statusText(report),
    metricBox(summary)
  ];
  if (shown.length === 0) {
    lines.push("", `${statusMark("pass")} ${ui.dim("No findings at the configured rigor level.")}`);
  } else {
    lines.push("", ui.bold("Findings"));
    let currentGroup = "";
    const groupItems = new Map;
    for (const finding of shown) {
      const group = findingGroupKey(finding);
      groupItems.set(group, [...groupItems.get(group) ?? [], finding]);
    }
    for (const [group, items] of groupItems) {
      if (group !== currentGroup) {
        lines.push(`
${ui.bold(group)}`);
        currentGroup = group;
      }
      lines.push(ui.dim("│"));
      items.forEach((finding, index2) => {
        const last = index2 === items.length - 1;
        const branch = last ? "╰─" : "├─";
        const detailPrefix = last ? "   └─" : "│  └─";
        lines.push(`${ui.dim(branch)} ${findingLevel(finding)} ${codeLabel(finding.code)}`);
        lines.push(`${ui.dim(detailPrefix)} ${finding.message}`);
        if (!last)
          lines.push(ui.dim("│"));
      });
    }
    if (findings.length > shown.length) {
      lines.push("", ui.dim(`... ${findings.length - shown.length} more findings hidden by --max-findings`));
    }
  }
  const exitHint = report.valid ? `${statusMark("pass")} ${ui.dim("exit 0")}` : `${statusMark("fail")} ${ui.dim("exit 1: produce evidence or lower the configured rigor")}`;
  lines.push("", exitHint);
  return `${lines.join(`
`)}
`;
}

// src/cliHelp.ts
function commandName() {
  const invoked = (process.argv[1] || "").split(/[\\/]/).pop() || "";
  return invoked && !["cli.js", "cli.ts", "node", "bun"].includes(invoked) ? invoked : "ztrack";
}
function printHelp() {
  const command = commandName();
  process.stdout.write(`${heading("ztrack", "typecheck your task management")}

${ui.bold("Usage")}
  ${ui.cyan(`${command} <resource> <action> [args...]`)}

${helpSection("top", "Core", [
    [`${command} init [--team KEY] [--preset basic|simple-sdlc|simple-spec|speckit]`, "create local config"],
    [`${command} check [--issues A-1,A-2]`, "verify checked claims"],
    [`${command} check --json`, "emit JSON report"]
  ])}

${helpSection("middle", "Workflow", [
    [`${command} issue scaffold`, "write starter body"],
    [`${command} issue create`, "create tracker issue"],
    [`${command} issue view A-1`, "inspect one issue"]
  ])}

${helpSection("bottom", "Data", [
    [`${command} snapshot export`, "export snapshot"],
    [`${command} lint [--fail-on-warn]`, "flag weak claims"],
    [`${command} visualizer [--preset p] [--port n]`, "open the web visualizer"]
  ])}

${ui.bold("Resources")}
  init, issue, project, milestone, sprint, label, state, user, search, query
  view, api, check, snapshot, fmt, lint, tx, evidence, ac, mcp, visualizer

${ui.dim(`Use ${command} <resource> --help or ${command} issue <action> --help for focused help.`)}
`);
}
function scaffoldCaseBody(title) {
  try {
    const projectRoot = projectRootFrom();
    const config = loadTrackerConfig(projectRoot);
    const preset = resolveTrackerValidation(config, projectRoot);
    const body = preset.scaffoldIssueBody?.(title);
    if (body)
      return body;
  } catch {}
  return `# ${title}

## Summary

One or two source-grounded sentences.

## Acceptance Criteria

- [ ] ac/01 status: pending Describe one observable, testable outcome. [1]

## Sources

[1] Where this requirement came from:
> Paste the source requirement here.

## Evidence

<!-- Add evidence rows such as:
[E1] type: artifact path: evidence/result.png ac: ac/01 justification: Shows the result.
-->
`;
}
function printIssueActionHelp(action) {
  const command = commandName();
  const usage = {
    scaffold: `${command} issue scaffold [--title text]`,
    list: `${command} issue list [--search text] [--state name|open|closed|all] [--label name] [--limit n] [--json fields]`,
    view: `${command} issue view <issue> [--json fields] [--comments] [--jq expr]`,
    get: `${command} issue view <issue> [--json fields] [--comments] [--jq expr]`,
    create: `${command} issue create --title text [--body text|--body-file path] [--label name] [--state name]`,
    edit: `${command} issue edit <issue> [--title text] [--body-file path] [--state name] [--add-label name] [--remove-label name]`,
    close: `${command} issue close <issue> [--reason completed|canceled] [--comment text|--comment-file path]`,
    comment: `${command} issue comment <issue> --body text|--body-file path`,
    comments: `${command} issue comments <issue> [--jq expr]`,
    history: `${command} issue history <issue> [--json] [--limit n] [--jq expr]`,
    relate: `${command} issue relate <issue> --blocks <blocked-issue>`,
    relations: `${command} issue relations <issue>|--all`,
    unrelate: `${command} issue unrelate <issue> --blocks <blocked-issue>`
  };
  const line = usage[action];
  if (!line)
    return false;
  process.stdout.write(`Usage: ${line}
`);
  return true;
}
function printResourceHelp(resource) {
  const command = commandName();
  if (resource === "issue") {
    process.stdout.write(`Usage: ${command} issue <action> [args...]

Actions: scaffold, list, view, get, create, edit, close, comment, comments,
history, relate, relations, unrelate.
`);
    return true;
  }
  if (resource === "project" || resource === "milestone") {
    process.stdout.write(`Usage: ${command} ${resource} <list|view|get|issues|create|update> [args...]
`);
    return true;
  }
  if (resource === "search" || resource === "query" || resource === "view") {
    process.stdout.write(`Usage: ${command} ${resource} <text-or-name> [args...]
`);
    return true;
  }
  if (resource === "organization" || resource === "check" || resource === "snapshot") {
    process.stdout.write(`Usage: ${command} check [--input file] [--issues A-1,A-2] [--json]
       ${command} snapshot <export|validate> [args...]
`);
    return true;
  }
  if (resource === "visualizer" || resource === "viz") {
    process.stdout.write(`Usage: ${command} visualizer [--preset default|speckit] [--port n] [--project dir]

Starts the web visualizer (a Bun app) over the local tracker. Defaults: preset
default, port 3300, project = current tracker root. Requires Bun (bun.sh).
`);
    return true;
  }
  return false;
}

// src/cliSnapshot.ts
import { readFileSync as readFileSync6, writeFileSync as writeFileSync5 } from "node:fs";
import { isAbsolute as isAbsolute4, resolve as resolve5 } from "node:path";

// src/cliHelp.ts
function commandName2() {
  const invoked = (process.argv[1] || "").split(/[\\/]/).pop() || "";
  return invoked && !["cli.js", "cli.ts", "node", "bun"].includes(invoked) ? invoked : "ztrack";
}
function printResourceHelp2(resource) {
  const command = commandName2();
  if (resource === "issue") {
    process.stdout.write(`Usage: ${command} issue <action> [args...]

Actions: scaffold, list, view, get, create, edit, close, comment, comments,
history, relate, relations, unrelate.
`);
    return true;
  }
  if (resource === "project" || resource === "milestone") {
    process.stdout.write(`Usage: ${command} ${resource} <list|view|get|issues|create|update> [args...]
`);
    return true;
  }
  if (resource === "search" || resource === "query" || resource === "view") {
    process.stdout.write(`Usage: ${command} ${resource} <text-or-name> [args...]
`);
    return true;
  }
  if (resource === "organization" || resource === "check" || resource === "snapshot") {
    process.stdout.write(`Usage: ${command} check [--input file] [--issues A-1,A-2] [--json]
       ${command} snapshot <export|validate> [args...]
`);
    return true;
  }
  if (resource === "visualizer" || resource === "viz") {
    process.stdout.write(`Usage: ${command} visualizer [--preset default|speckit] [--port n] [--project dir]

Starts the web visualizer (a Bun app) over the local tracker. Defaults: preset
default, port 3300, project = current tracker root. Requires Bun (bun.sh).
`);
    return true;
  }
  return false;
}

// src/cliSnapshot.ts
async function writeOutput(text4, outPath) {
  if (!outPath) {
    process.stdout.write(text4);
    return;
  }
  writeFileSync5(outPath, text4);
  process.stdout.write(`${outPath}
`);
}
async function handleSnapshotCommand(args) {
  if (args[0] !== "check" && args[0] !== "organization" && args[0] !== "snapshot")
    return false;
  const action = args[0] === "check" ? "validate" : args[1];
  const flagArgs = args[0] === "check" ? args.slice(1) : args.slice(2);
  if (!action || action === "--help" || action === "-h" || action === "help") {
    printResourceHelp2(args[0] === "snapshot" ? "snapshot" : "organization");
    return true;
  }
  const knownFlags = {
    export: new Set(["--out"]),
    validate: new Set(["--input", "--issues", "--case", "--categories", "--profile", "--fail-on-warning", "--verify-commits", "--errors-only", "--output", "--json", "--max-findings"])
  };
  const allowedFlags = knownFlags[action];
  if (allowedFlags) {
    const unknownFlags = flagArgs.filter((token) => token.startsWith("--") && !allowedFlags.has(token));
    if (unknownFlags.length > 0) {
      const commandName3 = args[0] === "check" ? "check" : `${args[0]} ${action}`;
      throw new Error(`tracker ${commandName3}: unknown flag(s) ${unknownFlags.join(", ")}. Valid flags: ${[...allowedFlags].join(" ")}`);
    }
  }
  const projectRoot = projectRootFrom();
  if (action === "export") {
    await writeOutput(`${JSON.stringify(exportTrackerSnapshot({ projectRoot }), null, 2)}
`, optionValue2(flagArgs, "--out"));
    return true;
  }
  if (action !== "validate")
    throw new Error(`tracker ${args[0]}: unknown action '${action ?? ""}'`);
  const inputPath = optionValue2(flagArgs, "--input");
  const issuesFilter = optionValue2(flagArgs, "--issues") || optionValue2(flagArgs, "--case");
  const issuesList = issuesFilter ? issuesFilter.split(",").map((s) => s.trim()).filter(Boolean) : undefined;
  const categoriesFlag = optionValue2(flagArgs, "--categories");
  const categories = categoriesFlag ? Object.fromEntries(categoriesFlag.split(",").map((pair) => {
    const [c, d] = pair.split("=");
    const depth = Number(d);
    if (!c?.trim() || d === undefined || !Number.isInteger(depth) || depth < 0) {
      throw new Error(`invalid --categories entry '${pair}' (expected name=N where N is a non-negative integer)`);
    }
    return [c.trim(), depth];
  })) : undefined;
  const profileFlag = optionValue2(flagArgs, "--profile");
  const report = checkTrackerSnapshot2(inputPath ? JSON.parse(readFileSync6(isAbsolute4(inputPath) ? inputPath : resolve5(projectRoot, inputPath), "utf8")) : exportTrackerSnapshot({ projectRoot, ...issuesList ? { issues: issuesList } : {} }), {
    projectRoot,
    ...issuesList ? { issues: issuesList } : {},
    ...categories ? { categories } : {},
    ...profileFlag ? { profiles: profileFlag === "none" ? [] : profileFlag.split(",").map((s) => s.trim()).filter(Boolean) } : {},
    failOnWarning: flagArgs.includes("--fail-on-warning"),
    verifyCommits: flagArgs.includes("--verify-commits")
  });
  const outputPath = optionValue2(flagArgs, "--output");
  if (outputPath)
    writeFileSync5(isAbsolute4(outputPath) ? outputPath : resolve5(projectRoot, outputPath), `${JSON.stringify(report, null, 2)}
`);
  if (flagArgs.includes("--json")) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}
`);
  } else {
    const shown = report.findings.filter((item) => !flagArgs.includes("--errors-only") || item.level === "error").slice().sort((a, b) => a.level === b.level ? 0 : a.level === "error" ? -1 : 1);
    const rawMax = optionValue2(flagArgs, "--max-findings");
    const parsedMax = Number(rawMax);
    const maxFindings = rawMax && Number.isInteger(parsedMax) && parsedMax >= 0 ? parsedMax : 120;
    process.stdout.write(renderCheckReport({ ...report, findings: shown }, { errorsOnly: flagArgs.includes("--errors-only"), maxFindings }));
  }
  process.exitCode = report.valid ? 0 : 1;
  return true;
}

// src/cliStyle.ts
var wantsColor2 = (stream) => {
  if (process.env.NO_COLOR)
    return false;
  if (process.env.FORCE_COLOR && process.env.FORCE_COLOR !== "0")
    return true;
  return Boolean(stream.isTTY);
};
var color3 = (open, close = "\x1B[0m") => (text4) => wantsColor2(process.stdout) ? `${open}${text4}${close}` : text4;
var ui2 = {
  dim: color3("\x1B[2m"),
  bold: color3("\x1B[1m"),
  green: color3("\x1B[32m"),
  red: color3("\x1B[31m"),
  yellow: color3("\x1B[33m"),
  blue: color3("\x1B[34m"),
  cyan: color3("\x1B[36m"),
  magenta: color3("\x1B[35m"),
  redBadge: color3("\x1B[41m\x1B[30m\x1B[1m"),
  yellowBadge: color3("\x1B[43m\x1B[30m\x1B[1m")
};
function heading2(title, subtitle) {
  return `${ui2.bold(title)}${subtitle ? ` ${ui2.dim(subtitle)}` : ""}`;
}
function stackedCommand(index2, title, command, description) {
  const commandLines = wrapWords(command, 50);
  const descriptionLines = wrapWords(description, 56);
  return [
    `  ${ui2.dim(`${index2}.`)} ${ui2.cyan(commandLines[0] ?? command)}`,
    ...commandLines.slice(1).map((line) => `     ${ui2.cyan(line)}`),
    ...descriptionLines.map((line) => `     ${ui2.dim(line)}`)
  ].join(`
`);
}
function wrapWords(text4, width) {
  const words = text4.split(" ");
  const lines = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > width && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current)
    lines.push(current);
  return lines;
}
function statusMark2(kind) {
  if (kind === "pass")
    return ui2.green("✓");
  if (kind === "fail")
    return ui2.red("✗");
  if (kind === "warn")
    return ui2.yellow("!");
  return ui2.blue("•");
}

// src/cli.ts
async function readStdinIfPiped() {
  if (process.stdin.isTTY)
    return;
  const chunks = [];
  for await (const chunk of process.stdin)
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  const text4 = Buffer.concat(chunks).toString("utf8");
  return text4.length ? text4 : undefined;
}
async function main() {
  const args = process.argv.slice(2);
  const command = commandName();
  if (!args.length || ["help", "--help", "-h"].includes(args[0])) {
    printHelp();
    return;
  }
  if (args[0] === "issue" && args[1] && args.slice(2).some((arg) => arg === "--help" || arg === "-h" || arg === "help") && printIssueActionHelp(args[1])) {
    return;
  }
  if (args.slice(1).some((arg) => arg === "--help" || arg === "-h" || arg === "help") && printResourceHelp(args[0])) {
    return;
  }
  if (args[0] === "init") {
    const root = resolve6(optionValue(args, "--root") || process.cwd());
    const preset = optionValue(args, "--preset", "basic");
    if (!initTrackerPresets2().includes(preset)) {
      throw new Error(`ztrack init: --preset must be one of ${initTrackerPresets2().join(", ")}`);
    }
    const result2 = initTrackerProject2(root, optionValue(args, "--team") || "LOCAL", { preset });
    if (result2.alreadyInitialized) {
      process.stdout.write(`${statusMark2("pass")} ${ui2.green("Already initialized")} ${ui2.dim(result2.configPath)}
`);
      return;
    }
    const configPath = result2.configPath;
    const teamKey = result2.teamKey;
    process.stdout.write([
      `${statusMark2("pass")} ${heading2("Initialized ztrack", `team ${teamKey}`)}`,
      `  ${ui2.dim(configPath)}`,
      ...result2.validationEntrypoint ? [`  ${ui2.dim(`validation ${result2.validationEntrypoint}`)}`] : [],
      "",
      ui2.bold("Next steps"),
      stackedCommand(1, "Write a starter issue", `${command} issue scaffold --title "First case" > body.md`, "Creates a markdown body with acceptance criteria and evidence sections."),
      "",
      stackedCommand(2, "Create work in the local tracker", `${command} issue create --title "First case" --label type:case --state "In Progress" --body-file body.md`, "Stores the issue where ztrack can validate it."),
      "",
      stackedCommand(3, "Verify checked claims", `${command} check`, "Fails if checked work lacks real evidence."),
      "",
      ui2.dim("Recognized labels include type:case and type:bug."),
      ui2.dim("Unrecognized checked work warns instead of passing silently."),
      ui2.dim("Edit the installed validation preset to encode your project rules."),
      ""
    ].join(`
`));
    return;
  }
  if (args[0] === "issue" && args[1] === "scaffold") {
    const title = optionValue(args, "--title") || "New case";
    process.stdout.write(scaffoldCaseBody(title));
    return;
  }
  if (args[0] === "fmt") {
    const inputPath = optionValue(args, "--input");
    const issueId = optionValue(args, "--issue");
    const write = args.includes("--write");
    const checkOnly = args.includes("--check");
    let text4;
    if (inputPath) {
      text4 = readFileSync7(isAbsolute5(inputPath) ? inputPath : resolve6(process.cwd(), inputPath), "utf8");
    } else if (issueId) {
      const fmtClient = createTrackerClient2();
      const issue = await fmtClient.issue.view(issueId, { json: "body" });
      text4 = String(issue.body ?? "");
    } else {
      throw new Error("tracker fmt: provide --issue <id> or --input <file> (plus --write to apply, --check to verify)");
    }
    const formatted = canonicalizeIssueMarkdown(text4);
    const canonical = text4 === formatted;
    if (checkOnly) {
      process.stdout.write(canonical ? `canonical
` : `NOT canonical (run tracker fmt --write)
`);
      process.exitCode = canonical ? 0 : 1;
      return;
    }
    if (write) {
      if (canonical) {
        process.stdout.write(`already canonical
`);
        return;
      }
      if (issueId) {
        const fmtClient = createTrackerClient2();
        await fmtClient.issue.edit(issueId, { body: formatted });
        process.stdout.write(`formatted ${issueId}
`);
      } else {
        writeFileSync6(isAbsolute5(inputPath) ? inputPath : resolve6(process.cwd(), inputPath), formatted);
        process.stdout.write(`formatted ${inputPath}
`);
      }
      return;
    }
    process.stdout.write(formatted);
    return;
  }
  if (args[0] === "mcp" && args[1] === "serve") {
    await serveMcp();
    return;
  }
  if (args[0] === "visualizer" || args[0] === "viz") {
    const packageRoot = resolve6(dirname3(fileURLToPath3(import.meta.url)), "..");
    const visualizerDir = join5(packageRoot, "visualizer");
    const serverEntry = join5(visualizerDir, "server.ts");
    if (!existsSync6(serverEntry)) {
      throw new Error(`ztrack visualizer: visualizer not found at ${serverEntry}`);
    }
    if (spawnSync("bun", ["--version"], { stdio: "ignore" }).status !== 0) {
      throw new Error("ztrack visualizer requires Bun (https://bun.sh) \u2014 the visualizer is a Bun app.");
    }
    if (!existsSync6(join5(visualizerDir, "node_modules", "react"))) {
      process.stderr.write(`${ui2.dim("Installing visualizer dependencies (one-time)\u2026")}
`);
      const install = spawnSync("bun", ["install"], { cwd: visualizerDir, stdio: "inherit" });
      if (install.status !== 0)
        throw new Error("ztrack visualizer: failed to install visualizer dependencies");
    }
    const project = optionValue(args, "--project") || (() => {
      try {
        return projectRootFrom2();
      } catch {
        return process.cwd();
      }
    })();
    const env = {
      ...process.env,
      PROJECT_DIR: resolve6(project),
      PRESET: optionValue(args, "--preset") || process.env.PRESET || "default"
    };
    const port = optionValue(args, "--port");
    if (port)
      env.PORT = port;
    await new Promise((resolvePromise, rejectPromise) => {
      const child = spawn2("bun", ["run", serverEntry], { stdio: "inherit", env });
      child.on("error", (error) => rejectPromise(error.code === "ENOENT" ? new Error("ztrack visualizer requires Bun (https://bun.sh) \u2014 the visualizer is a Bun app.") : error));
      child.on("exit", (code2) => {
        process.exitCode = code2 ?? 0;
        resolvePromise();
      });
    });
    return;
  }
  const client = createTrackerClient2();
  if (args[0] === "api") {
    const action = args[1];
    if (!action || action === "--help" || action === "-h" || action === "help") {
      process.stdout.write(`Usage: ${command} api <query|serve> [args...]

GraphQL-shaped query against the local tracker store.

  ${command} api query --query '{ issues(first: 10) { nodes { identifier title } } }'
  ${command} api serve --host 127.0.0.1 --port 8765
`);
      return;
    }
    if (action === "query") {
      const query = optionValue(args, "--query");
      if (!query)
        throw new Error("tracker api query: --query required");
      process.stdout.write(`${JSON.stringify(await client.graphql(query), null, 2)}
`);
      return;
    }
    if (action === "serve") {
      await serveTrackerApi({
        host: optionValue(args, "--host", "127.0.0.1"),
        port: Number(optionValue(args, "--port", "8765"))
      });
      return;
    }
    throw new Error(`tracker api: unknown action '${action ?? ""}'`);
  }
  if (args[0] === "tx") {
    const action = args[1];
    const filePath = optionValue(args, "--file");
    if (!action || !["plan", "apply"].includes(action) || !filePath) {
      throw new Error('usage: tracker tx <plan|apply> --file tx.json   (tx.json: {"edits": [{"issue": "A-1", "op": "check", "acId": "dev/01", ...}]}; apply accepts {"base": {...}} from a prior plan)');
    }
    const spec = JSON.parse(readFileSync7(isAbsolute5(filePath) ? filePath : resolve6(process.cwd(), filePath), "utf8"));
    if (action === "plan") {
      const plan = await planTx(spec.edits);
      process.stdout.write(`${JSON.stringify(plan, null, 2)}
`);
      return;
    }
    const result2 = await applyTx(spec.edits, { projectRoot: projectRootFrom2(), ...spec.base ? { base: spec.base } : {} });
    process.stdout.write(`${JSON.stringify(result2, null, 2)}
`);
    process.exitCode = result2.committed ? 0 : 1;
    return;
  }
  if (args[0] === "lint") {
    const projectRoot = projectRootFrom2();
    const snapshot = exportTrackerSnapshot2({ projectRoot });
    const issuesFilter = optionValue(args, "--issues");
    const issueSet = issuesFilter ? new Set(issuesFilter.split(",").map((s) => s.trim()).filter(Boolean)) : null;
    const { loadTrackerConfig: loadTrackerConfig3 } = await Promise.resolve().then(() => (init_config(), exports_config));
    const config = loadTrackerConfig3(projectRoot);
    const findings = snapshot.cases.filter((c) => !issueSet || issueSet.has(c.identifier)).flatMap((c) => lintIssueBody(String(c.body ?? ""), c.identifier, config));
    if (args.includes("--json"))
      process.stdout.write(`${JSON.stringify({ findings }, null, 2)}
`);
    else
      for (const f of findings)
        process.stdout.write(`${f.severity.toUpperCase()} ${f.rule}: issue=${f.issue} ${f.message} | ${f.excerpt ?? ""}
`);
    process.exitCode = findings.some((f) => f.severity === "error") || args.includes("--fail-on-warn") && findings.length > 0 ? 1 : 0;
    return;
  }
  if (args[0] === "annotations") {
    throw new Error("ztrack annotations requires the optional @volter/twin peer dependency and a mirrored world store.");
  }
  if (await handleEvidenceCommand(args, client))
    return;
  if (args[0] === "ac") {
    const action = args[1];
    const issueId = args[2];
    const acId = args[3];
    if (!action || !issueId || !acId || !["check", "uncheck", "set-status"].includes(action)) {
      throw new Error("usage: tracker ac <check|uncheck|set-status> <issue> <acId> [--commit sha] [--evidence E1,E2] [--proof P1] [--status s] [--no-anchor] [--dry-run]");
    }
    const issue = await client.issue.view(issueId, { json: "body" });
    const body = String(issue.body ?? "");
    const evidence = optionValue(args, "--evidence").split(",").map((s) => s.trim()).filter(Boolean);
    const proof = optionValue(args, "--proof").split(",").map((s) => s.trim()).filter(Boolean);
    const result2 = action === "check" ? applyAcMutation2(body, {
      op: "check",
      acId,
      ...optionValue(args, "--commit") ? { commit: optionValue(args, "--commit") } : {},
      ...evidence.length ? { evidence } : {},
      ...proof.length ? { proof } : {},
      anchor: !args.includes("--no-anchor")
    }) : action === "uncheck" ? applyAcMutation2(body, { op: "uncheck", acId }) : applyAcMutation2(body, { op: "set-status", acId, status: optionValue(args, "--status") });
    const willBePassed = action === "check" || action === "set-status" && optionValue(args, "--status") === "passed";
    if (!args.includes("--dry-run")) {
      const gate = willBePassed && result2.changed;
      const gateRoot = gate ? projectRootFrom2() : "";
      const errorSig = (f) => `${f.code}|${f.message}|${JSON.stringify(f.details ?? {})}`;
      const errorsBefore = gate ? new Set((checkTrackerSnapshot(exportTrackerSnapshot2({ projectRoot: gateRoot, issues: [issueId] }), { issues: [issueId] }).findings ?? []).filter((f) => f.level === "error").map(errorSig)) : new Set;
      await client.issue.edit(issueId, { body: result2.body });
      if (gate) {
        const after = checkTrackerSnapshot(exportTrackerSnapshot2({ projectRoot: gateRoot, issues: [issueId] }), { issues: [issueId] });
        const introduced = (after.findings ?? []).filter((f) => f.level === "error" && !errorsBefore.has(errorSig(f)));
        if (introduced.length > 0) {
          await client.issue.edit(issueId, { body });
          throw new Error(`Refusing to mark ${acId} on ${issueId} passed: the check introduces validation errors (checked without the evidence its rule requires).
` + introduced.map((f) => `  - ${f.code}: ${f.message}`).join(`
`) + `
Supply the evidence (e.g. --commit <sha> --evidence E1 --proof P1, or add the required Evidence entry first), then re-run.`);
        }
      }
    }
    process.stdout.write(`${JSON.stringify({ issue: issueId, acId, changed: result2.changed, dryRun: args.includes("--dry-run"), itemAfter: result2.itemAfter }, null, 2)}
`);
    return;
  }
  if (await handleSnapshotCommand(args))
    return;
  let forwardArgs = args;
  if (args[0] === "issue" && args[1] === "edit") {
    const expectState = optionValue(args, "--expect-state");
    const expectBodySha = optionValue(args, "--expect-body-sha");
    if (expectState || expectBodySha) {
      const identifier = args[2] ?? "";
      const view = await client.command(["issue", "view", identifier, "--json", "state,body"]);
      const current = JSON.parse(view.stdout);
      const currentBodySha = createHash5("sha256").update(current.body ?? "").digest("hex");
      const conflicts = [];
      if (expectState && current.state !== expectState) {
        conflicts.push(`state is ${JSON.stringify(current.state ?? null)}, expected ${JSON.stringify(expectState)}`);
      }
      if (expectBodySha && currentBodySha !== expectBodySha) {
        conflicts.push(`body sha256 is ${currentBodySha}, expected ${expectBodySha}`);
      }
      if (conflicts.length) {
        process.stderr.write(`${JSON.stringify({ ok: false, error: "precondition-failed", issue: identifier, conflicts, currentState: current.state ?? null, currentBodySha }, null, 2)}
`);
        process.exitCode = 1;
        return;
      }
      forwardArgs = args.filter((arg, index2) => arg !== "--expect-state" && arg !== "--expect-body-sha" && args[index2 - 1] !== "--expect-state" && args[index2 - 1] !== "--expect-body-sha");
    }
  }
  const result = await client.command(forwardArgs, args[0] === "extract-issue-ref" ? await readStdinIfPiped() : undefined);
  if (result.stdout)
    process.stdout.write(result.stdout);
  if (result.stderr)
    process.stderr.write(result.stderr);
}
main().catch((error) => {
  console.error(`${statusMark2("fail")} ${ui2.red(error instanceof Error ? error.message : String(error))}`);
  process.exit(1);
});
