package com.example.ict361_lab.model;

/**
 * Domain-level student record used by the ViewModel/UI layer. Deliberately
 * separate from network.dto.StudentDto (the raw JSON shape) and from
 * whatever Room entity the local-storage/sync team introduces — mapping
 * between those and this class happens in the repository layer, so a
 * change to the wire format or the local schema doesn't ripple into every
 * screen.
 */
public class Student {
    private final String studentId;      // immutable server id — never re-editable
    private final String studentNumber;  // 9-digit string, may have leading zeroes
    private final String studentName;
    private final String status;         // "active" | "deleted"
    private final int version;           // bump on every server-side edit; use for conflict checks
    private final String programCode;    // CS | IT | DS
    private final String groupCode;      // G01..G04, or null for Unassigned

    public Student(String studentId, String studentNumber, String studentName, String status,
                   int version, String programCode, String groupCode) {
        this.studentId = studentId;
        this.studentNumber = studentNumber;
        this.studentName = studentName;
        this.status = status;
        this.version = version;
        this.programCode = programCode;
        this.groupCode = groupCode;
    }

    /**
     * @deprecated kept only so the original (id, name) template code keeps
     * compiling; use the full constructor for anything backed by real data.
     */
    @Deprecated
    public Student(String id, String name) {
        this(id, null, name, "active", 1, null, null);
    }

    public String getId() { return studentId; } // kept for source compatibility with existing callers
    public String getStudentId() { return studentId; }
    public String getStudentNumber() { return studentNumber; }
    public String getName() { return studentName; } // kept for source compatibility with existing callers
    public String getStudentName() { return studentName; }
    public String getStatus() { return status; }
    public int getVersion() { return version; }
    public String getProgramCode() { return programCode; }
    public String getGroupCode() { return groupCode; } // null means Unassigned
}
