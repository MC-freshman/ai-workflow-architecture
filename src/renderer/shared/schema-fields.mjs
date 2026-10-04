export function resolveSchema(schema,root) {
  if(!schema?.$ref)return schema || {};
  if(!schema.$ref.startsWith('#/'))return {unsupported:true};
  const parts=schema.$ref.slice(2).split('/').map(value=>value.replaceAll('~1','/').replaceAll('~0','~'));
  let value=root;for(const part of parts)value=value?.[part];return value || {unsupported:true};
}
export function convertFields(schema,value,root=schema,depth=0) {
  if(depth>16)throw Error('MCP_SCHEMA_UNSUPPORTED');schema=resolveSchema(schema,root);
  if(value===undefined || value==='')return undefined;
  if(schema.enum)return schema.enum.find(row=>String(row)===String(value));
  if(['integer','number'].includes(schema.type)){const number=Number(value);if(!Number.isFinite(number) || schema.type==='integer' && !Number.isInteger(number))throw Error('SOFTWARE_ARGUMENT_INVALID');return number;}
  if(schema.type==='boolean')return typeof value==='boolean'?value:value==='true';
  if(schema.type==='object' || schema.properties)return Object.fromEntries(Object.entries(value || {}).map(([key,item])=>[key,convertFields(schema.properties?.[key] || schema.additionalProperties || {},item,root,depth+1)]).filter(([,item])=>item!==undefined));
  if(schema.type==='array')return (value || []).map(row=>convertFields(schema.items,row,root,depth+1));
  return value;
}
