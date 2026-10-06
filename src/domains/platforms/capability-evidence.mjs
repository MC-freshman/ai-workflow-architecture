// Resolve only names covered by real evidence. Unknown/still-failing declarations survive.
export function clearProvenLegacyGaps(capabilities,{proof,evidencePath,evidenceSha256,clientEvidence,now}) {
  const proven={
    'runner-protocol-prepare':proof.prompt?.prepareOk===true,
    'terminal-stop-with-evidence':proof.prompt?.stopOk===true,
    'sealed-script-environment':proof.checks?.['script-environment-isolation-jail']===true,
    'peer-dispatch':proof.checks?.peerDispatch===true,
    'software-face':proof.checks?.['software-call']===true,
    'action:prompt':proof.checks?.['prompt-stage-claim']===true,
    'action:script':proof.checks?.['script-environment-isolation-jail']===true,
    'action:peer':proof.checks?.peerDispatch===true,
    'action:software-call':proof.checks?.['software-call']===true,
    'mcp-tool-surface':Boolean(clientEvidence)
  };
  capabilities.resolvedLegacyGaps={...capabilities.resolvedLegacyGaps};
  for(const [key,passed] of Object.entries(proven)) {
    if(!passed) continue;
    const hadGap=['unverified','declaredAbsent','gapPlan'].some(field=>Object.hasOwn(capabilities[field] || {},key));
    const legacyCheck=['runner-protocol-prepare','terminal-stop-with-evidence'].includes(key);
    if(legacyCheck && capabilities.checks?.[key]===false) capabilities.checks[key]=true;
    for(const field of ['unverified','declaredAbsent','gapPlan']) if(capabilities[field]) delete capabilities[field][key];
    if(hadGap) capabilities.resolvedLegacyGaps[key]={resolvedAt:now,...(key==='mcp-tool-surface'?clientEvidence:{evidencePath,evidenceSha256})};
  }
  capabilities.attestedAt=now;
  return capabilities;
}
