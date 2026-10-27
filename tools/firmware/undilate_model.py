"""Rewrite dilated convolutions in the RR-TCN .tflite without SPACE_TO_BATCH_ND.

The converter turns every dilated Conv1D into
    SPACE_TO_BATCH_ND -> EXPAND_DIMS -> CONV_2D (batch = dilation) -> RESHAPE -> BATCH_TO_SPACE_ND.
On the ESP32-S3 (esp32 Arduino core 3.x, TFLM + ESP-NN) this pattern gives wrong
outputs: `afib_stream.py --model-check` on 27.10.2026 showed AF-like inputs at
prob 0.02-0.07 on the chip versus 0.90-0.996 on the PC (docs/BOARD_DAY.md, A4).

This script replaces each pattern with
    EXPAND_DIMS -> CONV_2D (batch 1, dilation_w = block) -> RESHAPE
keeping the same int8 weights, biases and quantisation. Mathematically identical;
the script checks bit-exact equality with the original on model_cases.json and
random inputs before writing.

Usage: python tools/firmware/undilate_model.py IN.tflite OUT.tflite
"""
import json
import sys
from pathlib import Path

import numpy as np
from tensorflow.lite.python import schema_py_generated as schema
from tensorflow.lite.tools import flatbuffer_utils as fu

OP = schema.BuiltinOperator


def opcode(model, op):
    oc = model.operatorCodes[op.opcodeIndex]
    return max(oc.builtinCode, oc.deprecatedBuiltinCode)


def const_value(model, sg, t):
    buf = model.buffers[sg.tensors[t].buffer].data
    return None if buf is None else np.frombuffer(bytes(buf), dtype=np.int32)


def rewrite(model):
    sg = model.subgraphs[0]
    ops = sg.operators
    out_ops, i, n = [], 0, 0
    while i < len(ops):
        op = ops[i]
        if opcode(model, op) != OP.SPACE_TO_BATCH_ND:
            out_ops.append(op)
            i += 1
            continue
        stb, exp, conv, resh, bts = ops[i:i + 5]
        kinds = [opcode(model, o) for o in (exp, conv, resh, bts)]
        assert kinds == [OP.EXPAND_DIMS, OP.CONV_2D, OP.RESHAPE, OP.BATCH_TO_SPACE_ND], kinds
        block = int(const_value(model, sg, stb.inputs[1])[0])
        assert not const_value(model, sg, stb.inputs[2]).any(), "STB paddings must be 0"
        assert not const_value(model, sg, bts.inputs[2]).any(), "BTS crops must be 0"
        x, y = stb.inputs[0], bts.outputs[0]
        xs, ys = list(sg.tensors[x].shape), list(sg.tensors[y].shape)  # [1, L, C], [1, L', C]
        assert xs[1] % block == 0
        # EXPAND_DIMS now reads the padded sequence directly
        exp.inputs[0] = x
        sg.tensors[exp.outputs[0]].shape = np.array([1, 1, xs[1], xs[2]], np.int32)
        # CONV_2D: dilation along width, batch 1
        opts = conv.builtinOptions
        assert opts.padding == schema.Padding.VALID and opts.strideW == 1
        opts.dilationWFactor = block
        sg.tensors[conv.outputs[0]].shape = np.array([1, 1, ys[1], ys[2]], np.int32)
        # RESHAPE: own shape constant, writes straight into the old BTS output
        new_shape = np.array([-1, ys[1], ys[2]], np.int32)
        b = schema.BufferT()
        b.data = np.frombuffer(new_shape.tobytes(), np.uint8)
        model.buffers.append(b)
        t = schema.TensorT()
        t.shape = np.array([3], np.int32)
        t.type = schema.TensorType.INT32
        t.buffer = len(model.buffers) - 1
        t.name = f"undilate_shape_{n}".encode()
        sg.tensors.append(t)
        resh.inputs[1] = len(sg.tensors) - 1
        if resh.builtinOptions is not None:
            resh.builtinOptions.newShape = new_shape
        resh.outputs[0] = y
        out_ops += [exp, conv, resh]
        i += 5
        n += 1
    sg.operators = out_ops
    return n


def run(path_or_bytes, x):
    from tensorflow.lite.python.interpreter import Interpreter, OpResolverType
    kw = {"model_content": path_or_bytes} if isinstance(path_or_bytes, bytes) else {"model_path": str(path_or_bytes)}
    it = Interpreter(**kw, experimental_op_resolver_type=OpResolverType.BUILTIN_REF)
    it.allocate_tensors()
    inp, out = it.get_input_details()[0], it.get_output_details()[0]
    it.set_tensor(inp["index"], x.reshape(inp["shape"]).astype(np.int8))
    it.invoke()
    return int(it.get_tensor(out["index"]).ravel()[0])


def main(src, dst):
    model = fu.read_model(src)
    n = rewrite(model)
    fu.write_model(model, dst)
    print(f"rewrote {n} dilated convolutions")
    cases = json.loads((Path(__file__).parent / "model_cases.json").read_text())
    cases = cases["cases"] if isinstance(cases, dict) else cases
    rng = np.random.default_rng(0)
    inputs = [np.array(c["input"], np.int8) for c in cases]
    inputs += [rng.integers(-128, 128, len(inputs[0])).astype(np.int8) for _ in range(500)]
    new_bytes = Path(dst).read_bytes()
    diff = [abs(run(src, x) - run(new_bytes, x)) for x in inputs]
    print(f"checked {len(diff)} inputs: max |old - new| = {max(diff)} LSB")
    if max(diff):
        sys.exit("NOT bit-exact, do not use")
    print(f"OK, {len(new_bytes)} bytes -> {dst}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
