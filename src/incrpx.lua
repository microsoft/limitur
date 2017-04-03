--[[

    INCRPX is an INCR command that allows setting the initial expiry
    time in milliseconds when the command is initially sent. Example:

     > EVAL "<script>" 1 foo 30000
       Will increment "foo" by 1 and set it to expire
       in 30 seconds if it doesn't already exist.

--]]

local val = redis.call('incr', KEYS[1])
if val == 1 then
    redis.call('pexpire', KEYS[1], ARGV[1])
    return { val, ARGV[1] }
end
return { val, redis.call('pttl', KEYS[1]) }
