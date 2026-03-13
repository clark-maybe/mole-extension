/**
 * 轻量 JSON Schema 参数校验器（覆盖本项目常用字段）
 */

export interface SchemaValidationResult {
  valid: boolean;
  errors: string[];
}

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
};

const typeLabel = (type: string): string => {
  switch (type) {
    case 'string': return '字符串';
    case 'number': return '数字';
    case 'integer': return '整数';
    case 'boolean': return '布尔值';
    case 'array': return '数组';
    case 'object': return '对象';
    default: return type;
  }
};

const validateSingleSchema = (schema: Record<string, any>, value: unknown, path: string): string[] => {
  const errors: string[] = [];

  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
    errors.push(`${path} 必须是以下值之一: ${schema.enum.join(', ')}`);
    return errors;
  }

  const type = schema.type as string | undefined;

  if (type === 'object') {
    if (!isPlainObject(value)) {
      errors.push(`${path} 必须是${typeLabel('object')}`);
      return errors;
    }

    const required = Array.isArray(schema.required) ? schema.required as string[] : [];
    for (const key of required) {
      if (!(key in value) || value[key] === undefined || value[key] === null) {
        errors.push(`${path}.${key} 为必填参数`);
      }
    }

    const properties = isPlainObject(schema.properties) ? schema.properties : {};
    for (const [key, propSchema] of Object.entries(properties)) {
      if (!(key in value) || value[key] === undefined) continue;
      if (!isPlainObject(propSchema)) continue;
      errors.push(...validateSchema(propSchema, value[key], `${path}.${key}`).errors);
    }

    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!(key in properties)) {
          errors.push(`${path}.${key} 不是允许的参数`);
        }
      }
    }

    if (isPlainObject(schema.additionalProperties)) {
      for (const [key, child] of Object.entries(value)) {
        if (key in properties) continue;
        errors.push(...validateSchema(schema.additionalProperties, child, `${path}.${key}`).errors);
      }
    }

    return errors;
  }

  if (type === 'array') {
    if (!Array.isArray(value)) {
      errors.push(`${path} 必须是${typeLabel('array')}`);
      return errors;
    }

    if (typeof schema.minItems === 'number' && value.length < schema.minItems) {
      errors.push(`${path} 至少需要 ${schema.minItems} 项`);
    }
    if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) {
      errors.push(`${path} 最多允许 ${schema.maxItems} 项`);
    }

    if (isPlainObject(schema.items)) {
      value.forEach((item, index) => {
        errors.push(...validateSchema(schema.items, item, `${path}[${index}]`).errors);
      });
    }

    return errors;
  }

  if (type === 'string') {
    if (typeof value !== 'string') {
      errors.push(`${path} 必须是${typeLabel('string')}`);
      return errors;
    }
    if (typeof schema.minLength === 'number' && value.length < schema.minLength) {
      errors.push(`${path} 长度不能小于 ${schema.minLength}`);
    }
    if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) {
      errors.push(`${path} 长度不能超过 ${schema.maxLength}`);
    }
    if (typeof schema.pattern === 'string') {
      try {
        const regex = new RegExp(schema.pattern);
        if (!regex.test(value)) {
          errors.push(`${path} 格式不符合要求`);
        }
      } catch {
        // ignore invalid regex
      }
    }
    return errors;
  }

  if (type === 'number' || type === 'integer') {
    if (typeof value !== 'number' || Number.isNaN(value)) {
      errors.push(`${path} 必须是${typeLabel(type)}`);
      return errors;
    }
    if (type === 'integer' && !Number.isInteger(value)) {
      errors.push(`${path} 必须是整数`);
    }
    if (typeof schema.minimum === 'number' && value < schema.minimum) {
      errors.push(`${path} 不能小于 ${schema.minimum}`);
    }
    if (typeof schema.maximum === 'number' && value > schema.maximum) {
      errors.push(`${path} 不能大于 ${schema.maximum}`);
    }
    return errors;
  }

  if (type === 'boolean') {
    if (typeof value !== 'boolean') {
      errors.push(`${path} 必须是${typeLabel('boolean')}`);
    }
    return errors;
  }

  return errors;
};

export const validateSchema = (
  schema: Record<string, any> | undefined,
  value: unknown,
  path: string = 'arguments',
): SchemaValidationResult => {
  if (!schema || !isPlainObject(schema)) return { valid: true, errors: [] };

  if (Array.isArray(schema.oneOf) && schema.oneOf.length > 0) {
    const branchErrors = schema.oneOf.map((branch) => {
      if (!isPlainObject(branch)) return ['oneOf 分支不是合法 schema'];
      return validateSchema(branch, value, path).errors;
    });
    const pass = branchErrors.some((errs) => errs.length === 0);
    if (pass) return { valid: true, errors: [] };
    return {
      valid: false,
      errors: [`${path} 不满足 oneOf 任一分支`, ...branchErrors.flat().slice(0, 4)],
    };
  }

  const errors = validateSingleSchema(schema, value, path);
  return {
    valid: errors.length === 0,
    errors,
  };
};
