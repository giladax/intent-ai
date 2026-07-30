import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// Without vitest `globals`, testing-library's auto-cleanup isn't wired — do it
// explicitly so DOM from one test never bleeds into the next.
afterEach(() => cleanup());
