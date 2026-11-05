import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SYSTEM_ID, GENERIC_SYSTEM_ID, createRegistry, defineSystem, genericoSystem, sheetDisplayName } from "../src/index";

test("registro: el genérico siempre está y es el predeterminado; ids duplicados fallan", () => {
  assert.equal(DEFAULT_SYSTEM_ID, GENERIC_SYSTEM_ID);
  const empty = createRegistry([]);
  assert.equal(empty.get(GENERIC_SYSTEM_ID), genericoSystem);
  assert.equal(empty.get("otro"), undefined);
  assert.deepEqual(empty.list().map((s) => s.id), [GENERIC_SYSTEM_ID]);
  const otro = defineSystem({ ...genericoSystem, id: "otro", nombre: "Otro" });
  assert.deepEqual(createRegistry([otro]).list().map((s) => s.id), [GENERIC_SYSTEM_ID, "otro"]);
  assert.throws(() => createRegistry([defineSystem({ ...genericoSystem })]), /duplicado/);
});

test("genérico: hoja mínima con defaults, campos de texto y ids únicos", () => {
  const g = genericoSystem;
  const s = g.sheet.schema.parse({ nombre: "Lía" });
  assert.deepEqual(s, { nombre: "Lía", notas: "", campos: [] });
  assert.deepEqual(g.sheet.empty?.("Lía"), s);
  assert.equal(g.sheet.schema.safeParse({ nombre: "" }).success, false);
  assert.equal(g.sheet.schema.safeParse({ nombre: "X", campos: [{ id: "a", nombre: "Fuerza", valor: 3 }] }).success, false, "solo texto");
  // El PATCH no rellena defaults (no pisa datos existentes).
  assert.deepEqual(g.sheet.patchSchema.parse({}), {});
  let n = 0;
  const fixedIds = g.sheet.normalize?.(
    { nombre: "X", notas: "", campos: [{ id: "a", nombre: "A", valor: "" }, { id: "a", nombre: "B", valor: "" }] },
    () => `nuevo${++n}`,
  );
  assert.deepEqual(fixedIds?.campos.map((c) => c.id), ["a", "nuevo1"]);
  assert.deepEqual(g.sheet.playerSafeKeys, ["notas", "campos"]);
  assert.equal(g.moves, undefined);
  assert.equal(g.catalog, undefined);
});


test("sheetDisplayName: usa el sistema y, si no está, el campo nombre", () => {
  assert.equal(sheetDisplayName(genericoSystem, { nombre: "Lía", notas: "", campos: [] }), "Lía");
  assert.equal(sheetDisplayName(undefined, { nombre: "Viejo" }), "Viejo");
  assert.equal(sheetDisplayName(undefined, { otra: 1 }), "¿?");
  assert.equal(sheetDisplayName(undefined, null), "¿?");
});
