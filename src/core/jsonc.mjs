// Native client settings may contain comments/trailing commas. This reads data, never evaluates it.
export function parseJsonc(input) {
  const text=String(input).replace(/^\uFEFF/,''),characters=[...text];let quoted=false,escaped=false;
  for(let index=0;index<characters.length;index++){
    const value=characters[index];
    if(quoted){if(escaped)escaped=false;else if(value==='\\')escaped=true;else if(value==='"')quoted=false;continue;}
    if(value==='"'){quoted=true;continue;}
    if(value==='/' && characters[index+1]==='/'){while(index<characters.length && !['\r','\n'].includes(characters[index]))characters[index++]=' ';index--;}
    else if(value==='/' && characters[index+1]==='*'){characters[index++]=' ';characters[index++]=' ';let closed=false;for(;index<characters.length;index++){if(characters[index]==='*' && characters[index+1]==='/'){characters[index]=characters[index+1]=' ';index++;closed=true;break;}if(!['\r','\n'].includes(characters[index]))characters[index]=' ';}if(!closed)throw Error('NATIVE_CONFIGURATION_INVALID');}
  }
  quoted=false;escaped=false;
  for(let index=0;index<characters.length;index++){const value=characters[index];if(quoted){if(escaped)escaped=false;else if(value==='\\')escaped=true;else if(value==='"')quoted=false;}else if(value==='"')quoted=true;else if(value===','){let next=index+1;while(/\s/.test(characters[next] || '') && next<characters.length)next++;if(['}',']'].includes(characters[next]))characters[index]=' ';}}
  return JSON.parse(characters.join(''));
}
