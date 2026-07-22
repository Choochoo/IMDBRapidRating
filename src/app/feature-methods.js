export function InstallFeatureMethods(target, ...features) {
  for (const feature of features) {
    for (const name of Object.getOwnPropertyNames(feature)) {
      if (name === "constructor")
        continue;
      if (Object.hasOwn(target.prototype, name))
        throw new Error(`Feature method ${name} is already defined on ${target.name}.`);
      Object.defineProperty(target.prototype, name, Object.getOwnPropertyDescriptor(feature, name));
    }
  }
}
