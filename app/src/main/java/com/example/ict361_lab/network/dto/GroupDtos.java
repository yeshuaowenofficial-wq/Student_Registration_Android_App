package com.example.ict361_lab.network.dto;

import com.google.gson.annotations.SerializedName;
import java.util.List;

public class GroupDtos {

    public static class GroupDto {
        @SerializedName("group_code")
        public String groupCode;
        public int capacity;
        @SerializedName("active_count")
        public int activeCount;
    }

    /** Response of GET /api/groups */
    public static class GroupsResponse {
        public List<GroupDto> groups;
    }
}
