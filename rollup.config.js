import { swc } from "rollup-plugin-swc3";
import { dts } from "rollup-plugin-dts";
import { nodeResolve } from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";
import { terser } from "rollup-plugin-terser";
import nodePolyfills from 'rollup-plugin-polyfill-node';
import bakedEnv from 'rollup-plugin-baked-env';
import pkg from './package.json';

const name = 'lottie-player';
const globals = {
  url: "url",
  lit: "lit",
  uuid: "uuid",
  "lit/decorators.js": "lit/decorators.js",
};

export default [
  // 기존 lottie-player 빌드
  {
    input: "./src/lottie-player.ts",
    treeshake: {
      moduleSideEffects: false,
      propertyReadSideEffects: false,
      tryCatchDeoptimization: false
    },
    output: [
      {
        file: './dist/lottie-player.js',
        format: "umd",
        name,
        minifyInternalExports: true,
        inlineDynamicImports: true,
        sourcemap: true,
        globals,
        hoistTransitiveImports: true,
      },
      {
        file: pkg.main,
        name,
        format: "cjs",
        minifyInternalExports: true,
        inlineDynamicImports: true,
        sourcemap: true,
        globals,
      },
      {
        file: pkg.module,
        format: "esm",
        name,
        inlineDynamicImports: true,
        sourcemap: true,
        globals,
      },
    ],
    plugins: [
      bakedEnv({ THORVG_VERSION: process.env.THORVG_VERSION }),
      nodePolyfills(),
      commonjs({
        include: /node_modules/
      }),
      swc({
        include: /\.[mc]?[jt]sx?$/,
        exclude: /node_modules/,
        tsconfig: "tsconfig.json",
        jsc: {
          parser: {
            syntax: "typescript",
            tsx: false,
            decorators: true,
            declaration: true,
            dynamicImport: true,
          },
          target: "esnext",
        },
      }),
      nodeResolve(),
      terser({
        compress: {
          pure_getters: true,
          passes: 3,
          drop_console: true,
          drop_debugger: true
        },
        mangle: true,
        output: {
          comments: false,
        },
      }),
    ],
  },
  {
    input: "./src/lottie-player.ts",
    treeshake: true,
    output: [
      {
        file: './dist/lottie-player.d.ts',
        format: "esm",
      }
    ],
    plugins: [
      dts(),
    ],
  },

  // Worker 플레이어 빌드
  {
    input: "./src/lottie-worker-player.ts",
    output: {
      format: 'es',
      file: './dist/lottie-worker-player.js',
      sourcemap: true
    },
    plugins: [
      swc({
        jsc: {
          parser: {
            syntax: 'typescript',
            decorators: true,
          },
          target: 'es2017',
        },
      }),
      nodeResolve(),
      commonjs(),
      terser()
    ]
  },

  // Worker 스크립트 빌드
  {
    input: "./src/worker/lottie-worker.ts",
    output: {
      format: 'es',
      file: './dist/lottie-worker.js',
      sourcemap: true
    },
    plugins: [
      swc({
        jsc: {
          parser: {
            syntax: 'typescript',
            decorators: true,
          },
          target: 'es2017',
        },
      }),
      nodeResolve(),
      commonjs(),
      terser()
    ]
  }
];
