# Reveal Grace Period Test Cases

## Overview
This document outlines the test cases for the reveal grace period functionality implemented in the sealed auction platform.

## Changes Made
1. Added `REVEAL_GRACE_PERIOD` constant (24 hours)
2. Added `reveal_deadline` field to Auction struct
3. Updated `create_auction` to set reveal deadline
4. Updated `reveal_bid` to check reveal deadline instead of auction end time
5. Updated `end_auction` to require reveal period to end

## Test Cases

### Test Case 1: Normal Auction Flow with Grace Period
**Steps:**
1. Create auction with duration 1 hour
2. Verify `reveal_deadline = end_time + 24 hours`
3. Commit bid before auction ends
4. Try to reveal bid after auction ends but before reveal deadline
5. **Expected:** Reveal should succeed
6. Try to end auction before reveal deadline
7. **Expected:** Should fail with "reveal period not ended"
8. Try to end auction after reveal deadline
9. **Expected:** Should succeed

### Test Case 2: Reveal After Grace Period
**Steps:**
1. Create auction with duration 1 hour
2. Commit bid before auction ends
3. Wait until after reveal deadline (end_time + 24 hours)
4. Try to reveal bid
5. **Expected:** Should fail with "Reveal period ended"

### Test Case 3: Multiple Bids with Grace Period
**Steps:**
1. Create auction with duration 2 hours
2. Commit multiple bids before auction ends
3. Reveal bids at different times:
   - Bid 1: 1 hour after auction ends (should succeed)
   - Bid 2: 23 hours after auction ends (should succeed)
   - Bid 3: 25 hours after auction ends (should fail)
4. End auction after 24 hours
5. **Expected:** Highest revealed bid wins

### Test Case 4: Edge Cases
**Steps:**
1. Create auction with 0 duration (should fail)
2. Create auction with maximum duration (365 days)
3. Verify reveal deadline is calculated correctly
4. Test reveal exactly at reveal deadline timestamp
5. **Expected:** Should fail (>= check)

## Implementation Details

### Constants
```rust
const REVEAL_GRACE_PERIOD: u64 = 24 * 60 * 60; // 24 hours
```

### Auction Struct Update
```rust
pub struct Auction {
    // ... existing fields ...
    pub reveal_deadline: u64,  // New field
    // ... rest of fields ...
}
```

### Key Logic Changes
1. **Create Auction:** `reveal_deadline = end_time + REVEAL_GRACE_PERIOD`
2. **Reveal Bid:** Check `timestamp < reveal_deadline` instead of `timestamp < end_time`
3. **End Auction:** Check `timestamp >= reveal_deadline` instead of `timestamp >= end_time`

## Benefits
1. **Fairness:** Bidders have adequate time to reveal their committed bids
2. **Flexibility:** 24-hour grace period accommodates different time zones and schedules
3. **Security:** Prevents auction creators from ending auctions prematurely to trap bids
4. **User Experience:** Reduces failed reveals due to timing issues

## Security Considerations
1. The grace period is fixed (24 hours) to prevent manipulation
2. Reveal deadline is set at auction creation and cannot be changed
3. Auctions can only be ended after the reveal period expires
4. All timing checks use the ledger timestamp for consistency
