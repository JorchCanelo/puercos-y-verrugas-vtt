import { test } from "node:test";
import assert from "node:assert/strict";
import { formatDiceExpr, parseChatRollCommand, parseDiceExpr } from "../src/index";

test("dados libres: interpreta expresiones con cantidad, dado y modificador", () => {
  assert.deepEqual(parseDiceExpr("3d8+2"), { cantidad: 3, caras: 8, modificador: 2 });
  assert.deepEqual(parseDiceExpr("d20"), { cantidad: 1, caras: 20, modificador: 0 });
  assert.deepEqual(parseDiceExpr(" 2D6 - 1 "), { cantidad: 2, caras: 6, modificador: -1 });
  assert.deepEqual(parseDiceExpr("20d100+20"), { cantidad: 20, caras: 100, modificador: 20 });
  assert.deepEqual(parseDiceExpr("1d4-20"), { cantidad: 1, caras: 4, modificador: -20 });
});

test("dados libres: rechaza expresiones fuera de los límites o mal escritas", () => {
  for (const bad of ["", "hola", "3d", "d", "0d6", "21d6", "1d7", "1d6+21", "1d6-21", "1d6+2+3", "1d6*2"]) {
    assert.ok("error" in parseDiceExpr(bad), `debería rechazar "${bad}"`);
  }
});

test("dados libres: formato canónico", () => {
  assert.equal(formatDiceExpr({ cantidad: 3, caras: 8, modificador: 2 }), "3d8+2");
  assert.equal(formatDiceExpr({ cantidad: 1, caras: 20, modificador: 0 }), "1d20");
  assert.equal(formatDiceExpr({ cantidad: 2, caras: 6, modificador: -1 }), "2d6-1");
});

test("comandos de chat: /r pública, /rp privada; el resto es un mensaje normal", () => {
  assert.deepEqual(parseChatRollCommand("/r 3d8+2"), { privada: false, expr: "3d8+2" });
  assert.deepEqual(parseChatRollCommand("/RP d20"), { privada: true, expr: "d20" });
  assert.deepEqual(parseChatRollCommand("/roll 2d6"), { privada: false, expr: "2d6" });
  assert.deepEqual(parseChatRollCommand("/r"), { privada: false, expr: "" });
  assert.equal(parseChatRollCommand("hola /r 2d6"), null);
  assert.equal(parseChatRollCommand("/rapido"), null);
  assert.equal(parseChatRollCommand("/rp2d6"), null);
});
