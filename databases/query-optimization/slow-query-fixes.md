# How to find slow queries


## MySQL

### Step 1: Finding the Slow Queries (The Hunting Ground)

### Turn on the Slow Query Log
First, you need to know which queries are actually slow. MySQL has a built-in "Slow Query Log" that records every query that takes longer than a certain threshold (usually 1 or 2 seconds).

```sql
-- Check if slow query log is enabled
SHOW VARIABLES LIKE 'slow_query_log';

-- Turn it on (if it's off)
SET GLOBAL slow_query_log = 'ON';

-- Set the threshold to 1 second (anything slower gets logged)
SET GLOBAL long_query_time = 1;

-- Where is the log file?
SHOW VARIABLES LIKE 'slow_query_log_file';
```

