import { run } from "@cycle/run";
import {
  makeDOMDriver,
  header,
  div,
  input,
  span,
  textarea,
  pre
} from "@cycle/dom";
import xs from "xstream";
import * as vm from "vm";
import wast2wasm from "wast2wasm";

function view(state) {
  return div(".tinker", [
    header([div("wasm-tinker")]),
    div(".contents", [
      div(".wast", [
        textarea(".wast-text", { props: { spellcheck: false } }, state.WAST)
      ]),

      div(".repl", [
        span([">", input(".repl-input", { props: { value: state.input } })]),

        ...state.replLog.map(s =>
          pre(
            ".log-item",
            { class: { error: s.error, result: s.result, info: s.info } },
            s.text
          )
        )
      ])
    ])
  ]);
}

const WAST = `
(module
  (export "main" (func $main))
  (func $main (result i32) (local $x i32) (local $y i32)
    (return
      (set_local $x (i32.const 5))
      (set_local $y (i32.const 10))
      (i32.add
        (get_local $x)
        (get_local $y)
      )
    )
  )
)
`.trim();

const initialState = {
  WAST,
  replLog: [],
  replState: vm.createContext({}),
  input: "",
  commandHistory: [],
  commandCursor: null
};

function replInput(input) {
  return function(state) {
    return {
      ...state,

      input
    };
  };
}

function updateWast(WAST) {
  return function(state) {
    return {
      ...state,

      WAST
    };
  };
}

function updateWASM(output) {
  const error = output.error;
  const exports = !error && output.instance.exports;
  const exportNames = Object.keys(exports);

  return function(state) {
    if (error) {
      return {
        ...state,

        replLog: [
          { error: true, text: "** Error compiling wast **\n" + error.message }
        ].concat(state.replLog)
      };
    } else {
      return {
        ...state,

        replState: vm.createContext({ ...state.replState, ...exports }),

        replLog: [
          {
            info: true,
            text: `** Compiled wast, exported ${exportNames.join(", ")} **`
          }
        ].concat(state.replLog)
      };
    }
  };
}

function previousCommand() {
  return function(state) {
    let commandCursor = state.commandCursor;

    if (commandCursor !== null) {
      commandCursor += 1;
    } else {
      commandCursor = 0;
    }

    if (commandCursor > state.commandHistory.length - 1) {
      commandCursor = state.commandHistory.length - 1;
    }

    return {
      ...state,

      commandCursor,

      input: state.commandHistory[commandCursor] || ""
    };
  };
}

function nextCommand() {
  return function(state) {
    let commandCursor = state.commandCursor;

    if (commandCursor !== null) {
      commandCursor -= 1;
    }

    if (commandCursor < 0) {
      commandCursor = null;
    }

    return {
      ...state,

      commandCursor,

      input: state.commandHistory[commandCursor] || ""
    };
  };
}
function replEnter(ev) {
  const code = ev.target.value;

  return function(state) {
    let result;
    let error;

    try {
      result = vm.runInContext(code, state.replState);
    } catch (e) {
      error = e;
    }

    if (code.trim() !== "") {
      state.commandHistory.unshift(code);
    }
    state.commandCursor = null;

    if (error) {
      return {
        ...state,

        input: "",

        replLog: [
          { error: true, text: "Error: " + error.message },
          { text: "> " + code },
        ].concat(state.replLog)
      };
    } else {
      return {
        ...state,

        input: "",

        replLog: [
          { result: true, text: JSON.stringify(result) },
          { text: "> " + code },
        ].concat(state.replLog)
      };
    }
  };
}

function compileWAST(wast) {
  return wast2wasm(wast)
    .then(output => {
      return (window as any).WebAssembly.instantiate(output.buffer, {
        imports: {}
      });
    })
    .catch(e => ({ error: e }));
}

function main(sources) {
  const wast$ = sources.DOM
    .select(".wast textarea")
    .events("change")
    .map(ev => ev.target.value)
    .startWith(WAST);

  const wasm$ = wast$
    .map(compileWAST)
    .map(xs.fromPromise)
    .flatten();

  const replInput$ = sources.DOM
    .select(".repl-input")
    .events("input")
    .map(ev => ev.target.value);
  const replKeyup$ = sources.DOM.select(".repl-input").events("keyup");

  const replEnter$ = replKeyup$.filter(ev => ev.keyCode === 13).map(replEnter);

  const previousCommand$ = replKeyup$
    .filter(ev => ev.keyCode === 38)
    .map(previousCommand);

  const nextCommand$ = replKeyup$
    .filter(ev => ev.keyCode === 40)
    .map(nextCommand);

  const reducer$ = xs.merge(
    wast$.map(updateWast),
    replEnter$,
    wasm$.map(updateWASM),
    replInput$.map(replInput),
    previousCommand$,
    nextCommand$
  );

  const state$ = reducer$.fold(
    (state, reducer) => (reducer as any)(state),
    initialState
  );

  return {
    DOM: state$.map(view)
  };
}

const drivers = {
  DOM: makeDOMDriver(document.body)
};

run(main, drivers);
