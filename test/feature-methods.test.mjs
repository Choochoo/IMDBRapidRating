import assert from "node:assert/strict";
import test from "node:test";
import { InstallFeatureMethods } from "../src/app/feature-methods.js";

function TestFeatureMethods() {
  class Target {}
  class Feature {
    Describe() {
      return `value:${this.value}`;
    }
  }

  InstallFeatureMethods(Target, Feature.prototype);
  const target = new Target();
  target.value = 7;
  assert.equal(target.Describe(), "value:7");
}

function TestFeatureCollision() {
  class Target {
    Run() {
      return "target";
    }
  }
  class Feature {
    Run() {
      return "feature";
    }
  }

  assert.throws(() => InstallFeatureMethods(Target, Feature.prototype), /Run is already defined/);
}

test("feature methods retain their class behavior when installed", TestFeatureMethods);
test("feature method collisions fail instead of silently replacing behavior", TestFeatureCollision);
