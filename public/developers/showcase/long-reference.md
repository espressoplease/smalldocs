# Launch operations reference

This reference keeps its major sections closed at first. Open the area needed for the current task or use the document navigation to move between headings.

## Before site handover

### Access and ownership

- Confirm named owners for building access, network commissioning, and customer onboarding.
- Record the escalation path for each external supplier.
- Store acceptance evidence beside the corresponding control.

### Acceptance thresholds

| Control | Required result | Evidence |
| --- | --- | --- |
| Network failover | Under 60 seconds | Timestamped test log |
| Inventory reconciliation | 100% sampled match | Signed count sheet |
| Dispatch recovery | Under 15 minutes | Dry-run record |

> Do not accept a verbal exception. Record the owner, expiry date, and compensating control.

## During the first operating week

### Daily review

1. Compare planned and handled volume.
2. Review late arrivals and dispatch exceptions.
3. Check the top-customer share of occupied capacity.
4. Record decisions and owners before the next shift.

### Escalation states

~~~mermaid
stateDiagram-v2
  [*] --> Normal
  Normal --> Watch: threshold missed once
  Watch --> Incident: threshold missed twice
  Watch --> Normal: next cycle passes
  Incident --> Recovery: owner and plan assigned
  Recovery --> Normal: three clean cycles
~~~

## Commercial controls

### Capacity commitments

Customer commitments should preserve a minimum 20% operating buffer until the first six months of demand are observed.

### Concentration

No single customer should represent more than 45% of occupied pallet positions at the expansion gate.

## Technical appendix

### Health endpoint

~~~typescript
export async function hubHealth(client: OperationsClient) {
  const [inventory, dispatch, network] = await Promise.all([
    client.inventoryStatus(),
    client.dispatchStatus(),
    client.networkStatus(),
  ]);

  return {
    ready: inventory.reconciled && dispatch.queueDepth < 20 && network.redundant,
    checkedAt: new Date().toISOString(),
  };
}
~~~

### Unknown future block

The renderer keeps an unrecognised fence readable rather than dropping the source.

~~~future-control
owner: operations
threshold: pending
~~~
