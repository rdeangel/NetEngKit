#!/bin/bash
# Check for required utilities
required_commands=("ping" "nslookup" "timeout" "awk")
missing_commands=()
for cmd in "${required_commands[@]}"; do
    if ! command -v "$cmd" &> /dev/null; then
        missing_commands+=("$cmd")
    fi
done
if [ ${#missing_commands[@]} -gt 0 ]; then
    echo "Error: Missing required utilities: ${missing_commands[*]}" >&2
    exit 1
fi

# Default values
DEFAULT_PING_COUNT=1
DEFAULT_PING_INTERVAL=1
DEFAULT_DNS_SERVER=""

# Initialize variables with defaults
SUBNET=""
ping_interval=$DEFAULT_PING_INTERVAL
ping_count=$DEFAULT_PING_COUNT
dns_server=$DEFAULT_DNS_SERVER
search_dns=""
hosts_file=""
MARKER="# MANAGED BY SUBNET SCANNER"

# Help message function
show_help() {
    echo "Usage: $0 [-c ping-count] [-i ping-interval] [-n dns-server] [-s search-dns] [-o output-file] [-h] <subnet>"
    echo "Scan a subnet and manage a hosts file, preserving existing entries."
    echo ""
    echo "Options:"
    echo "  -c, --ping-count NUM     Number of ping packets to send (default: $DEFAULT_PING_COUNT)"
    echo "  -i, --ping-interval SEC  Interval between ping requests in seconds (default: $DEFAULT_PING_INTERVAL)"
    echo "  -n, --dns-server DNS     Use specified DNS server for nslookups (default: System's DNS)"
    echo "  -s, --search-dns WORD    Only show IPs with DNS entries containing WORD (case-insensitive regex)"
    echo "  -o, --output-file FILE   Manage entries in /etc/hosts style output to FILE (default: No output file)"
    echo "  -h, --help               Display this help message and exit"
    echo ""
    echo "Arguments:"
    echo "  subnet                   Target subnet in CIDR notation (e.g., 192.168.1.0/24)"
}

# Validate IP address format
validate_ip() {
    local ip=$1
    local stat=1
    if [[ $ip =~ ^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$ ]]; then
        IFS='.' read -r -a octets <<< "$ip"
        stat=0
        for octet in "${octets[@]}"; do
            if (( octet < 0 || octet > 255 )); then
                stat=1
                break
            fi
        done
    fi
    return $stat
}

# Validate subnet format
validate_subnet() {
    local subnet=$1
    local ip cidr
    IFS=/ read -r ip cidr <<< "$subnet"
    if ! validate_ip "$ip"; then
        echo "Invalid IP address: $ip" >&2
        return 1
    fi
    if [[ ! $cidr =~ ^[0-9]+$ ]] || (( cidr < 1 || cidr > 32 )); then
        echo "Invalid CIDR prefix: $cidr (must be 1-32)" >&2
        return 1
    fi
    return 0
}

# Parse command-line options
while [[ $# -gt 0 ]]; do
    case "$1" in
        -h|--help)  show_help; exit 0 ;;
        -c|--ping-count)    ping_count="$2";    shift 2 ;;
        -i|--ping-interval) ping_interval="$2"; shift 2 ;;
        -n|--dns-server)    dns_server="$2";    shift 2 ;;
        -s|--search-dns)    search_dns="$2";    shift 2 ;;
        -o|--output-file)   hosts_file="$2";    shift 2 ;;
        -*)                 echo "Unknown option: $1" >&2; exit 1 ;;
        *)                  SUBNET="$1"; shift; break ;;
    esac
done

if [[ $# -gt 0 ]]; then echo "Unexpected arguments: $*" >&2; exit 1; fi
if [[ -z "$SUBNET" ]]; then show_help >&2; exit 1; fi
if ! validate_subnet "$SUBNET"; then exit 1; fi

# --- DNS Server Check ---
if [[ -n "$dns_server" ]]; then
    if ! validate_ip "$dns_server"; then
        echo "Error: Invalid DNS server IP address: $dns_server" >&2
        exit 1
    fi
    if ! timeout 3 nslookup google.com "$dns_server" &> /dev/null; then
        echo "Error: DNS server '$dns_server' is unreachable or not responding to DNS queries." >&2
        exit 1
    fi
    echo "DNS server '$dns_server' is reachable and responding." >&2
fi

export ping_interval dns_server ping_count search_dns hosts_file MARKER

echo "Scanning subnet using ping and nslookup..." >&2

# Function to convert IP to integer
ip_to_int() {
    local ip=$1
    IFS=. read -r a b c d <<< "$ip"
    echo $(( (a << 24) | (b << 16) | (c << 8) | d ))
}

# Function to convert integer to IP
int_to_ip() {
    local num="$1"
    echo "$(( (num >> 24) & 0xFF )).$(( (num >> 16) & 0xFF )).$(( (num >> 8) & 0xFF )).$(( num & 0xFF ))"
}

# --- process_ip (for table output) ---
process_ip() {
    local ip=$1
    local ping_success
    local ptr
    local hostname
    declare -a hostnames=()

    if [[ -n "$search_dns" ]]; then
        ptr=$(timeout 1 nslookup "$ip" ${dns_server:+"$dns_server"} 2>/dev/null | awk -F'name = ' '/name = / {print $2}' | sed 's/\.$//')
        while read -r hostname; do
            [[ -n "$hostname" ]] && hostnames+=("$hostname")
        done <<< "$ptr"

        local filtered_hostnames=()
        shopt -s nocasematch
        for h in "${hostnames[@]}"; do
            if [[ "$h" =~ $search_dns ]]; then
                filtered_hostnames+=("$h")
            fi
        done
        shopt -u nocasematch
        hostnames=("${filtered_hostnames[@]}")

        if [[ ${#hostnames[@]} -eq 0 ]]; then
            return
        fi
        ping -c "$ping_count" -W "$ping_interval" "$ip" >/dev/null 2>&1
        ping_success=$?
    else
        ping -c "$ping_count" -W "$ping_interval" "$ip" >/dev/null 2>&1
        ping_success=$?
        ptr=$(timeout 1 nslookup "$ip" ${dns_server:+"$dns_server"} 2>/dev/null | awk -F'name = ' '/name = / {print $2}' | sed 's/\.$//')
        while read -r hostname; do
            [[ -n "$hostname" ]] && hostnames+=("$hostname")
        done <<< "$ptr"
    fi

    if [[ $ping_success -ne 0 && ${#hostnames[@]} -eq 0 ]]; then
        return
    fi

    local count=${#hostnames[@]}
    local ip_display
    if [[ $ping_success -ne 0 ]]; then
        ip_display="${ip} (!)"
    else
        ip_display="$ip"
    fi

    if [[ $count -eq 0 ]]; then
        printf "%s\t%d\t%s\n" "$ip_display" "$count" "(none)"
    else
        IFS=$'\n' sorted=($(sort -V <<< "${hostnames[*]}"))
        for hostname in "${sorted[@]}"; do
            printf "%s\t%d\t%s\n" "$ip_display" "$count" "$hostname"
        done
    fi
}

# --- process_ip_for_hosts ---
process_ip_for_hosts() {
    local ip=$1
    local ping_success
    local ptr
    local hostname
    declare -a hostnames=()

    ping -c "$ping_count" -W "$ping_interval" "$ip" >/dev/null 2>&1
    ping_success=$?
    if [[ $ping_success -ne 0 ]]; then return; fi

    ptr=$(timeout 1 nslookup "$ip" ${dns_server:+"$dns_server"} 2>/dev/null | awk -F'name = ' '/name = / {print $2}' | sed 's/\.$//')
    while read -r hostname; do
        [[ -n "$hostname" ]] && hostnames+=("$hostname")
    done <<< "$ptr"

    if [[ ${#hostnames[@]} -eq 0 ]] && [[ -z "$search_dns" ]] ; then
      return
    fi

    if [[ -n "$search_dns" ]] ; then
       local filtered_hostnames=()
        shopt -s nocasematch
        for h in "${hostnames[@]}"; do
            if [[ "$h" =~ $search_dns ]]; then
                filtered_hostnames+=("$h")
            fi
        done
        shopt -u nocasematch
        hostnames=("${filtered_hostnames[@]}")
      fi

    if [[ ${#hostnames[@]} -eq 0 ]]; then
     return
    fi

    IFS=$'\n' sorted=($(sort -V <<< "${hostnames[*]}"))
    for hostname in "${sorted[@]}"; do
        echo -e "$ip\t$hostname $MARKER"
    done
}
export -f process_ip process_ip_for_hosts int_to_ip ip_to_int

# Calculate IP range
IFS=/ read -r ip cidr <<< "$SUBNET"
ip_int=$(ip_to_int "$ip")
mask=$(( 0xFFFFFFFF << (32 - cidr) ))
network=$(( ip_int & mask ))
broadcast=$(( network | (~mask & 0xFFFFFFFF) ))

if (( cidr >= 31 )); then
    start=$network
    end=$broadcast
else
    start=$(( network + 1 ))
    end=$(( broadcast - 1 ))
fi

temp_file=$(mktemp)
scanned_hosts_temp=$(mktemp)

# Generate data for the TABLE
seq "$start" "$end" | \
    xargs -P 100 -I {} bash -c 'int_to_ip {}' | \
    xargs -P 100 -I {} bash -c 'process_ip {}' | sort -V > "$temp_file"

# Generate data for the HOSTS FILE
seq "$start" "$end" | \
    xargs -P 100 -I {} bash -c 'int_to_ip {}' | \
    while read line; do
        ip="$line"
        int_ip=$(ip_to_int "$ip")
        echo "$int_ip $line"
    done | sort -n -k1,1 | cut -d' ' -f2- | \
    xargs -P 100 -I {} bash -c 'process_ip_for_hosts {}' | \
    while read line; do
        ip=$(echo "$line" | cut -d$'\t' -f1)
        int_ip=$(ip_to_int "$ip")
        echo "$int_ip $line"
    done | sort -n -k1,1 | cut -d' ' -f2- > "$scanned_hosts_temp"

# --- Hosts File Management ---
if [[ -n "$hosts_file" ]]; then
    temp_hosts_file=$(mktemp)
    original_hosts_content=""

    if [[ -f "$hosts_file" ]]; then
      original_hosts_content=$(grep -v "$MARKER" "$hosts_file" | grep -v "Entries below are managed by")
    fi

    printf "%s\n" "$original_hosts_content" > "$temp_hosts_file"

    if [[ -n "$original_hosts_content" ]] && [[ ! "$original_hosts_content" =~ $'\n$' ]]; then
        echo "" >> "$temp_hosts_file"
    fi

    echo "# Entries below are managed by $(basename "$0") script" >> "$temp_hosts_file"
    cat "$scanned_hosts_temp" >> "$temp_hosts_file"
    mv "$temp_hosts_file" "$hosts_file"
    echo "Hosts file updated at: $hosts_file" >&2
fi

if [[ ! -s "$temp_file" ]]; then
    echo "No results."
    rm "$temp_file" "$scanned_hosts_temp"
    exit 0
fi

gawk -F '\t' -v search_dns="$search_dns" '
BEGIN {
    max_ip_len = length("IP Address")
    max_count_len = length("DNS Count")
    max_hostname_len = length("Associated Hostnames/A Records")
    total_dns_entries = 0
    used_ips = 0
    hosts_with_dns = 0
    hosts_no_dns = 0
    reachable_ips = 0
    last_ip = ""
    ping_failure_found = 0
}
{
    ip = $1
    count = $2
    hostname = $3

    current_ip_len = length(ip)
    if (current_ip_len > max_ip_len) max_ip_len = current_ip_len

    current_count_len = length(count"")
    if (current_count_len > max_count_len) max_count_len = current_count_len

    current_hostname_len = length(hostname)
    if (current_hostname_len > max_hostname_len) max_hostname_len = current_hostname_len

    if (ip != last_ip) {
        used_ips++
        if (count > 0) {
            hosts_with_dns++
            total_dns_entries += count
        } else {
            hosts_no_dns++
        }
        if (index(ip, " (!)") == 0) {
            reachable_ips++
        }
        last_ip = ip
    }

    if (ip ~ / \(!\)$/) {
        ping_failure_found = 1
    }

    key = ip "|" count
    if (!(key in hosts_count)) {
        order[++n] = key
    }
    idx = ++hosts_count[key]
    hosts[key, idx] = hostname
}
END {
    ip_col_width = max_ip_len + 2
    count_col_width = max_count_len + 2
    hostname_col_width = max_hostname_len + 2

    separator = sprintf("+%s+%s+%s+",
        sprintf("%*s", ip_col_width, ""),
        sprintf("%*s", count_col_width, ""),
        sprintf("%*s", hostname_col_width, ""))
    gsub(/ /, "-", separator)

    print ""
    print separator
    printf("| %-*s | %*s | %-*s |\n",
        max_ip_len, "IP Address", max_count_len, "DNS Count", max_hostname_len, "Associated Hostnames/A Records")
    print separator

    for (i = 1; i <= n; i++) {
        key = order[i]
        split(key, parts, "|")
        ip = parts[1]
        count = parts[2]

        delete sorted_hosts
        sorted_count = 0
        for (j = 1; j <= hosts_count[key]; j++) {
             sorted_hosts[++sorted_count] = hosts[key, j]
        }
        if (sorted_count > 0){
           tmpfile = "sort_temp_" PROCINFO["pid"]
           for (k=1; k <= sorted_count; k++) { print sorted_hosts[k] > tmpfile}
           close(tmpfile)
           system("sort -V " tmpfile " > " tmpfile".sorted")
           sorted_count = 0;
           while ((getline line < (tmpfile".sorted")) > 0){  sorted_hosts[++sorted_count] = line }
           close(tmpfile".sorted")
           system("rm " tmpfile " " tmpfile".sorted")
        }

        for (j = 1; j <= sorted_count; j++) {
            if (j == 1) {
                printf("| %-*s | %*d | %-*s |\n", max_ip_len, ip, max_count_len, count, max_hostname_len, sorted_hosts[j])
            } else {
                printf("| %-*s | %*s | %-*s |\n", max_ip_len, "", max_count_len, "", max_hostname_len, sorted_hosts[j])
            }
        }
        if (i < n) {
          print separator
        }
    }
    print separator

    if (ping_failure_found) {
      print "(!) --> IP unreachable via ping"
    }
    print ""
    print "Statistics:"
    print "-----------------------------"
    total_usable = '"$end"' - '"$start"' + 1

    if (search_dns != "") {
        printf "Reachable IPs (detected via ping): %d\n", reachable_ips
        printf "Unreachable IPs (detected via ping): %d\n", (used_ips - reachable_ips)
        printf "Total IPs Found: %d\n", used_ips
        printf "Total DNS entries found: %d\n", total_dns_entries
    } else {
      hosts_no_dns = used_ips - hosts_with_dns
      printf "Used/Reachable IPs (detected via ping): %d\n", used_ips
      printf "Unused/Unreachable IPs (detected via ping): %d\n", total_usable - used_ips
      printf "Total subnet usable IPs: %d\n", total_usable
      printf "Hosts with DNS records: %d\n", hosts_with_dns
      printf "Hosts without DNS records: %d\n", hosts_no_dns
      printf "Total DNS entries found: %d\n", total_dns_entries
    }
    print ""
}
' "$temp_file"

rm "$temp_file" "$scanned_hosts_temp"
