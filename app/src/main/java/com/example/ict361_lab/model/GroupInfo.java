package com.example.ict361_lab.model;

/** A lab group's code, capacity and current active-member count. */
public class GroupInfo {
    private final String groupCode;
    private final int capacity;
    private final int activeCount;

    public GroupInfo(String groupCode, int capacity, int activeCount) {
        this.groupCode = groupCode;
        this.capacity = capacity;
        this.activeCount = activeCount;
    }

    public String getGroupCode() { return groupCode; }
    public int getCapacity() { return capacity; }
    public int getActiveCount() { return activeCount; }
    public boolean isFull() { return activeCount >= capacity; }
}
