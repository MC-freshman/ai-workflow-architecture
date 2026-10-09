import React from 'react';
import {resolveSchema} from './schema-fields.mjs';
export function SchemaFields({schema,value,onChange,root=schema,label='参数',depth=0}) {
  schema=resolveSchema(schema,root);
  if(depth>12 || schema.unsupported || schema.oneOf || schema.anyOf || schema.allOf)return <div className="scan-result warning">{label} 需要专用结构选择器，请使用对应适配器；不会提交猜测参数。</div>;
  const title=schema.title || label;
  if(schema.enum || schema.type==='boolean')return <label className="wizard-field">{title}<select value={value ?? ''} onChange={event=>onChange(event.target.value)}><option value="">请选择</option>{(schema.enum || ['true','false']).map(row=><option key={String(row)} value={String(row)}>{String(row)}</option>)}</select></label>;
  if(schema.type==='object' || schema.properties)return <fieldset><legend>{title}</legend>{Object.entries(schema.properties || {}).map(([name,property])=><SchemaFields key={name} schema={property} root={root} depth={depth+1} label={name+(schema.required?.includes(name)?'（必填）':'')} value={value?.[name]} onChange={item=>onChange({...value,[name]:item})} />)}{schema.additionalProperties && <p>自由键字段需要专用适配表单，当前仅填写已定义字段。</p>}</fieldset>;
  if(schema.type==='array')return <fieldset><legend>{title}</legend>{(value || []).map((row,index)=><div key={index}><SchemaFields schema={schema.items} root={root} depth={depth+1} label={'第 '+(index+1)+' 项'} value={row} onChange={item=>onChange(value.map((previous,i)=>i===index?item:previous))} /><button className="small-button" onClick={()=>onChange(value.filter((_,i)=>i!==index))}>移除此项</button></div>)}<button className="small-button" onClick={()=>onChange([...(value || []),''])}>添加一项</button></fieldset>;
  return <label className="wizard-field">{title}<input value={value ?? ''} type={['number','integer'].includes(schema.type)?'number':'text'} step={schema.type==='integer'?'1':'any'} onChange={event=>onChange(event.target.value)} />{schema.description && <span className="muted">{schema.description}</span>}</label>;
}
