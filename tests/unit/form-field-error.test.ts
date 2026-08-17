import { describe, expect, it } from "vitest";
import { fieldErrorProps } from "../../src/components/form-field-error";

describe("fieldErrorProps", () => {
  it("returns no extra props when there is no error for this field", () => {
    expect(fieldErrorProps(undefined, "email")).toEqual({});
    expect(fieldErrorProps({}, "email")).toEqual({});
    expect(fieldErrorProps({ password: "Required" }, "email")).toEqual({});
  });

  it("returns the red-state class plus aria-invalid/aria-describedby when this field has an error", () => {
    const props = fieldErrorProps({ email: "Enter a valid email address." }, "email");
    expect(props).toEqual({
      className: "field-input-error",
      "aria-invalid": true,
      "aria-describedby": "email-error",
    });
  });

  it("keys aria-describedby off the id passed in, not the field's message text", () => {
    const props = fieldErrorProps({ scaleReferenceLength: "Enter a reference length greater than 0." }, "scaleReferenceLength");
    expect(props["aria-describedby"]).toBe("scaleReferenceLength-error");
  });

  it("never marks a field invalid just because a DIFFERENT field errored", () => {
    const fieldErrors = { firstName: "First name is required." };
    expect(fieldErrorProps(fieldErrors, "lastName")).toEqual({});
  });
});
